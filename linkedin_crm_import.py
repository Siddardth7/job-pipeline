#!/usr/bin/env python3
"""
linkedin_crm_import.py — Import contacts_export.csv from the LinkedIn CRM tool
into the Supabase linkedin_dm_contacts table.

Usage:
  python linkedin_crm_import.py --csv ~/Desktop/linkedin-crm/output/contacts_export.csv
"""
import argparse
import csv
import hashlib
import os
import re
import sys

from dotenv import load_dotenv
from supabase import create_client

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env.local'))

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY')


# ── Helpers ───────────────────────────────────────────────────────────────────
def make_id(name: str, linkedin_url: str) -> str:
    """Generate a stable, collision-resistant slug from name + linkedin_url."""
    base = re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-'))
    base = re.sub(r'-+', '-', base).strip('-')
    if linkedin_url and linkedin_url.strip():
        suffix = hashlib.md5(linkedin_url.strip().encode()).hexdigest()[:4]
        return f"{base}-{suffix}"
    return base or 'unknown'


def normalize_status(raw: str) -> str:
    """Normalize CRM tool conv_status strings to 5 canonical values.

    Evaluation order matters — 'follow' check must come before 'active'
    so that 'Active Follow-Up' is classified as Follow-Up Needed, not Opportunity Active.
    """
    s = (raw or '').lower().strip()
    if 'follow' in s:
        return 'Follow-Up Needed'
    if 'opportunit' in s or 'active' in s:
        return 'Opportunity Active'
    if 'await' in s or 'waiting' in s:
        return 'Awaiting Reply'
    if 'replied' in s or 'responded' in s:
        return 'Replied'
    # 'cold', 'no action', or empty all fall through to default
    return 'Cold / No Action'


def to_int(val: str):
    try:
        return int(val.strip())
    except (ValueError, AttributeError):
        return None


def to_bool(val: str) -> bool:
    return (val or '').strip().lower() == 'yes'


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Import LinkedIn CRM CSV to Supabase')
    parser.add_argument('--csv', required=True, help='Path to contacts_export.csv')
    args = parser.parse_args()

    csv_path = os.path.expanduser(args.csv)
    if not os.path.exists(csv_path):
        print(f"Error: file not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local",
              file=sys.stderr)
        sys.exit(1)

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    rows = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get('Name') or '').strip()
            linkedin_url = (row.get('LinkedIn Profile URL') or '').strip()
            rows.append({
                'id':            make_id(name, linkedin_url),
                'name':          name or None,
                'company':       (row.get('Company') or '').strip() or None,
                'position':      (row.get('Position / Title') or '').strip() or None,
                'role_type':     (row.get('Role Type') or '').strip() or None,
                'conv_status':   normalize_status(row.get('Conversation Status', '')),
                'last_contact':  (row.get('Last Contact Date') or '').strip() or None,
                'days_since':    to_int(row.get('Days Since Contact', '')),
                'message_count': to_int(row.get('Message Count', '')),
                'follow_up':     to_bool(row.get('Follow-Up Needed', '')),
                'priority':      to_int(row.get('Priority Score (1-10)', '')),
                'next_action':   (row.get('Next Action') or '').strip() or None,
                'summary':       (row.get('Conversation Summary') or '').strip() or None,
                'notes':         (row.get('Notes') or '').strip() or None,
                'linkedin_url':  linkedin_url or None,
                'email':         (row.get('Email') or '').strip() or None,
            })

    if not rows:
        print("No rows found in CSV. Nothing imported.")
        return

    # Upsert in one batch (all rows have unique ids)
    client.table('contacts').upsert(rows, on_conflict='id').execute()

    follow_ups = sum(1 for r in rows if r['follow_up'])
    active = sum(1 for r in rows if r['conv_status'] == 'Opportunity Active')
    print(f"Imported {len(rows)} contacts. {follow_ups} follow-ups. {active} active opportunities.")


if __name__ == '__main__':
    main()
