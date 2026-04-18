#!/usr/bin/env python3
"""
linkedin_messages_import.py — Import contacts directly from LinkedIn's messages.csv export.

Usage:
  python linkedin_messages_import.py --zip ~/Desktop/Basic_LinkedInDataExport_*.zip
"""
import argparse
import csv
import hashlib
import io
import os
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env.local'))
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY')
USER_ID = os.environ.get('JOBAGENT_USER_ID')

# ── Helpers ───────────────────────────────────────────────────────────────────

def make_id(name: str, linkedin_url: str) -> str:
    base = re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-'))
    base = re.sub(r'-+', '-', base).strip('-')
    if linkedin_url and linkedin_url.strip():
        suffix = hashlib.md5(linkedin_url.strip().encode()).hexdigest()[:4]
        return f"{base}-{suffix}"
    return base or 'unknown'


def detect_owner(rows: list) -> str:
    """Identify the account owner as the person who appears most as FROM."""
    from collections import Counter
    counts = Counter(r['FROM'] for r in rows if r['FROM'] != 'LinkedIn Member')
    return counts.most_common(1)[0][0]


def parse_date(s: str):
    try:
        return datetime.strptime(s.strip(), '%Y-%m-%d %H:%M:%S UTC')
    except (ValueError, AttributeError):
        return None


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Import LinkedIn DM contacts from messages.csv export zip')
    parser.add_argument('--zip', required=True, help='Path to LinkedIn export .zip file')
    args = parser.parse_args()

    zip_path = os.path.expanduser(args.zip)
    if not os.path.exists(zip_path):
        print(f"Error: file not found: {zip_path}", file=sys.stderr)
        sys.exit(1)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local", file=sys.stderr)
        sys.exit(1)

    if not USER_ID:
        print("Error: JOBAGENT_USER_ID must be set", file=sys.stderr)
        sys.exit(1)

    # Read messages.csv from zip
    with zipfile.ZipFile(zip_path, 'r') as z:
        names = z.namelist()
        msg_file = next((n for n in names if n.lower() == 'messages.csv' or n.lower().endswith('/messages.csv')), None)
        if not msg_file:
            print("Error: messages.csv not found in zip", file=sys.stderr)
            sys.exit(1)
        raw = z.read(msg_file).decode('utf-8', errors='replace')

    rows = list(csv.DictReader(io.StringIO(raw)))
    if not rows:
        print("No messages found.")
        return

    me = detect_owner(rows)
    print(f"Account owner detected: {me}")

    # Group messages by conversation
    convos = defaultdict(list)
    for r in rows:
        convos[r['CONVERSATION ID']].append(r)

    # Build one contact per conversation partner
    contacts_by_key = {}

    for conv_id, msgs in convos.items():
        # Sort messages by date ascending
        msgs.sort(key=lambda m: parse_date(m['DATE']) or datetime.min)

        # Find the other participant
        other_name = None
        other_url = None
        for m in msgs:
            if m['FROM'] and m['FROM'] != me and m['FROM'] != 'LinkedIn Member':
                other_name = m['FROM'].strip()
                other_url = m['SENDER PROFILE URL'].strip() or None
                break
        if not other_name:
            # Try recipients
            for m in msgs:
                recipients = m['TO'].split(',')
                urls = m['RECIPIENT PROFILE URLS'].split(',')
                for i, name in enumerate(recipients):
                    name = name.strip()
                    url = urls[i].strip() if i < len(urls) else ''
                    if name and name != me and name != 'LinkedIn Member':
                        other_name = name
                        other_url = url or None
                        break
                if other_name:
                    break

        if not other_name:
            continue

        # Dates and message count
        dates = [parse_date(m['DATE']) for m in msgs]
        dates = [d for d in dates if d]
        last_dt = max(dates) if dates else None
        last_contact = last_dt.strftime('%Y-%m-%d') if last_dt else None
        days_since = (datetime.utcnow() - last_dt).days if last_dt else None

        # Summary: conversation title or first non-empty content snippet
        title = msgs[0].get('CONVERSATION TITLE', '').strip()
        first_content = next((m['CONTENT'].strip() for m in msgs if m.get('CONTENT', '').strip()), '')
        summary = title if title else (first_content[:200] if first_content else None)

        key = other_url or other_name
        existing = contacts_by_key.get(key)

        # Merge: keep the conversation with the most recent last_contact
        if not existing or (last_contact and (not existing['last_contact'] or last_contact > existing['last_contact'])):
            contacts_by_key[key] = {
                'user_id':       USER_ID,
                'id':            make_id(other_name, other_url or ''),
                'name':          other_name,
                'linkedin_url':  other_url,
                'last_contact':  last_contact,
                'days_since':    days_since,
                'message_count': len(msgs),
                'summary':       summary,
                # Enriched fields default — user fills these in the UI
                'company':       None,
                'position':      None,
                'role_type':     None,
                'conv_status':   'Cold / No Action',
                'follow_up':     False,
                'priority':      None,
                'next_action':   None,
                'notes':         None,
                'email':         None,
                'source':        'linkedin_messages',
            }
        else:
            # Update message count (sum across conversations)
            existing['message_count'] += len(msgs)

    # Deduplicate on id (same slug may result from different keys)
    by_id = {}
    for c in contacts_by_key.values():
        existing = by_id.get(c['id'])
        if not existing or (c['last_contact'] and (not existing['last_contact'] or c['last_contact'] > existing['last_contact'])):
            by_id[c['id']] = c
        else:
            existing['message_count'] += c['message_count']
    rows_to_upsert = list(by_id.values())
    if not rows_to_upsert:
        print("No contacts found.")
        return

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.table('contacts').upsert(rows_to_upsert, on_conflict='id').execute()

    follow_ups = sum(1 for r in rows_to_upsert if r['follow_up'])
    print(f"Imported {len(rows_to_upsert)} contacts from {len(convos)} conversations. {follow_ups} follow-ups.")


if __name__ == '__main__':
    main()
