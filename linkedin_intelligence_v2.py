#!/usr/bin/env python3
"""
linkedin_intelligence_v2.py — Full CRM intelligence analysis of LinkedIn DM conversations.

Reads raw messages.csv from your LinkedIn export zip, analyzes every conversation
for persona, stage, tone, POC scoring, follow-up intelligence, and CRM enrichment,
then upserts the results into the linkedin_dm_contacts Supabase table.

Usage:
  python linkedin_intelligence_v2.py --zip ~/Desktop/Basic_LinkedInDataExport_03-25-2026.zip [--dry-run]

Options:
  --zip       Path to LinkedIn export zip file
  --dry-run   Print analysis without writing to Supabase
  --limit N   Only process first N contacts (for testing)
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
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env.local'))
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY')

# ── Date utilities ─────────────────────────────────────────────────────────────

def parse_date(s: str):
    try:
        return datetime.strptime(s.strip(), '%Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return None


def days_since(dt):
    if not dt:
        return None
    now = datetime.now(timezone.utc)
    return (now - dt).days


# ── ID generation (matches existing import script) ────────────────────────────

def make_id(name: str, linkedin_url: str) -> str:
    base = re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-'))
    base = re.sub(r'-+', '-', base).strip('-')
    if linkedin_url and linkedin_url.strip():
        suffix = hashlib.md5(linkedin_url.strip().encode()).hexdigest()[:4]
        return f"{base}-{suffix}"
    return base or 'unknown'


# ── Persona Classification ────────────────────────────────────────────────────

RECRUITER_SIGNALS = [
    'recruiter', 'recruiting', 'talent acquisition', 'talent partner',
    'technical recruiter', 'technical sourcer', 'sourcer', 'sourcing',
    'hr ', 'human resources', 'people operations', 'people team',
    'staffing', 'headhunter', 'staffing partner',
]
HIRING_MANAGER_SIGNALS = [
    'hiring manager', 'engineering manager', 'engineering director',
    'director of engineering', 'head of engineering', 'vp of engineering',
    'vp engineering', 'director of software', 'director of technology',
    'head of technology', 'team lead', 'tech lead', 'group manager',
    'senior manager', 'staff manager',
]
SENIOR_ENGINEER_SIGNALS = [
    'senior engineer', 'senior software', 'principal engineer', 'principal software',
    'staff engineer', 'staff software', 'distinguished engineer', 'fellow',
    'senior developer', 'principal developer', 'staff developer',
    'senior sde', 'principal sde', 'staff sde', 'senior swe', 'principal swe',
    'senior architect', 'solution architect', 'technical architect',
]
EXECUTIVE_SIGNALS = [
    'cto', 'ceo', 'coo', 'cpo', 'president', 'co-founder', 'cofounder',
    'founder', 'vice president', 'vp of', 'chief technology', 'chief product',
    'chief operating', 'chief executive',
]
ALUMNI_SIGNALS = [
    'uiuc', 'university of illinois', 'illinois', 'u of i', 'illini',
]
MENTOR_SIGNALS = [
    'mentor', 'coach', 'advisor', 'faculty', 'professor', 'lecturer',
    'ta', 'teaching assistant',
]
PEER_ENGINEER_SIGNALS = [
    'software engineer', 'software developer', 'sde', 'swe',
    'developer', 'engineer', 'data scientist', 'data engineer',
    'machine learning', 'ml engineer', 'ai engineer', 'backend', 'frontend',
    'full stack', 'fullstack', 'cloud engineer', 'devops', 'platform engineer',
    'robotics', 'embedded', 'firmware', 'systems engineer',
    'manufacturing engineer', 'process engineer', 'quality engineer',
    'aerospace engineer', 'mechanical engineer', 'chemical engineer',
    'materials engineer',
]

RECRUITER_MESSAGE_SIGNALS = [
    'i am a recruiter', "i'm a recruiter", 'on behalf of', 'our client',
    'exciting opportunity', 'open role', 'open position', 'job opening',
    'looking for candidates', 'are you open to', 'would you be interested',
    'talent acquisition', 'hiring for', 'we are hiring', "we're hiring",
    'great opportunity', 'come across your profile', 'came across your profile',
    'reach out about', 'amazing opportunity',
]
HIRING_MANAGER_MESSAGE_SIGNALS = [
    'my team', 'our team is looking', 'team is hiring', 'hiring for my team',
    'we have an opening', 'we have a role', 'join our team',
    'i manage', 'i lead a team', 'direct reports',
]
REFERRAL_MESSAGE_SIGNALS = [
    'pass along', 'forward your', 'share your', 'put in a referral',
    'refer you', 'connected you', 'introduction', 'intro to',
    'let me know if you apply', 'submit your application', 'internal referral',
]
WARM_MESSAGE_SIGNALS = [
    'happy to help', 'glad to help', 'reach out anytime', 'feel free to reach out',
    'good luck', 'best of luck', 'great to connect', 'lovely to meet',
    'nice to meet', 'great talking', 'enjoyed our conversation',
    'coffee chat', 'virtual coffee', 'catch up', 'let me know how i can help',
    'sounds like a great fit', "you'd be a great", 'impressive background',
    'strong background', 'perfect candidate',
]
ENCOURAGING_MESSAGE_SIGNALS = [
    'great profile', 'impressive', 'strong candidate', 'perfect fit',
    "you're a great fit", 'your background is', 'right fit', 'excellent',
    'fantastic', 'really exciting', 'love your background',
]
DISMISSIVE_MESSAGE_SIGNALS = [
    'not a good fit', 'not the right fit', 'not what we are looking for',
    'not what we\'re looking for', 'no openings', 'not hiring',
    'not looking', 'position has been filled', 'role has been filled',
    'appreciate your interest but', 'unfortunately', 'regret to inform',
    'wish you the best', 'not currently hiring',
]
PROMISE_SIGNALS = [
    ("send me your resume", "resume request"),
    ("send your resume", "resume request"),
    ("forward your profile", "profile forwarding"),
    ("pass along your", "profile forwarding"),
    ("share your linkedin", "profile forwarding"),
    ("apply and let me know", "apply prompt"),
    ("let me know when you apply", "apply prompt"),
    ("apply through our portal", "apply prompt"),
    ("reach out to", "referral routing"),
    ("connect you with", "introduction"),
    ("i'll introduce you", "introduction"),
    ("i will introduce you", "introduction"),
    ("set up a call", "call scheduled"),
    ("schedule a call", "call scheduled"),
    ("get back to you", "follow-up promise"),
    ("circle back", "follow-up promise"),
    ("keep you in mind", "passive consideration"),
    ("keep an eye out", "passive consideration"),
]
HIRING_PROCESS_SIGNALS = [
    'interview', 'phone screen', 'technical screen', 'onsite', 'on-site',
    'offer', 'offer letter', 'hiring decision', 'recruiter screen',
    'application status', 'next steps', 'moved forward', 'move forward',
    'we will be in touch', "we'll be in touch", 'background check',
    'reference check', 'final round',
]


def classify_persona(name, position, conv_title, messages_text, linkedin_url):
    """
    Returns (persona: str, confidence: int 0-100)
    """
    combined = ' '.join(filter(None, [
        (position or '').lower(),
        (conv_title or '').lower(),
        (messages_text or '')[:2000].lower(),
    ]))

    def score_signals(signals):
        return sum(1 for s in signals if s in combined)

    recruiter_score = score_signals(RECRUITER_SIGNALS) * 3 + score_signals(RECRUITER_MESSAGE_SIGNALS) * 2
    hm_score = score_signals(HIRING_MANAGER_SIGNALS) * 3 + score_signals(HIRING_MANAGER_MESSAGE_SIGNALS) * 2
    senior_eng_score = score_signals(SENIOR_ENGINEER_SIGNALS) * 3
    exec_score = score_signals(EXECUTIVE_SIGNALS) * 4
    alumni_score = score_signals(ALUMNI_SIGNALS) * 3
    mentor_score = score_signals(MENTOR_SIGNALS) * 3
    peer_score = score_signals(PEER_ENGINEER_SIGNALS) * 1

    scores = [
        ('Recruiter', recruiter_score, 70),
        ('Hiring Manager', hm_score, 65),
        ('Executive', exec_score, 75),
        ('Senior Engineer', senior_eng_score, 60),
        ('Alumni', alumni_score, 65),
        ('Potential Mentor', mentor_score, 60),
        ('Peer Engineer', peer_score, 40),
    ]

    best = max(scores, key=lambda x: x[1])
    if best[1] == 0:
        return 'Unknown', 20

    persona, raw_score, base_conf = best
    confidence = min(95, base_conf + raw_score * 5)

    # Check for referral signal in messages
    ref_score = score_signals(REFERRAL_MESSAGE_SIGNALS)
    if ref_score >= 2 and persona not in ('Recruiter', 'Hiring Manager'):
        persona = 'Referral Contact'
        confidence = min(85, 55 + ref_score * 10)

    return persona, confidence


# ── Conversation Stage Detection ──────────────────────────────────────────────

def classify_stage(msgs, me, they_replied, two_way, total_exchanges, referral_secured,
                   promise_made, hiring_process_related, days_since_contact, tone):
    """
    Returns conversation_stage string from the 17-level system.
    """
    msg_count = len(msgs)

    if msg_count == 0:
        return 'Not Connected'

    # Check if I ever sent
    i_sent = any(m['FROM'].strip() == me for m in msgs)
    they_sent = any(m['FROM'].strip() != me and m['FROM'].strip() != 'LinkedIn Member' for m in msgs)

    if not i_sent and not they_sent:
        return 'Not Connected'

    if referral_secured:
        return 'Referral Secured'

    if hiring_process_related:
        return 'Hiring Process Related'

    if promise_made:
        return 'Referral Requested'

    # Confirmed POC: two-way, warm, 6+ exchanges
    if two_way and total_exchanges >= 6 and tone in ('warm', 'encouraging'):
        return 'Strong Rapport'

    # Active conversation
    if two_way and total_exchanges >= 3:
        return 'Active Conversation'

    # Warm contact: two-way, warm tone
    if two_way and tone in ('warm', 'encouraging', 'helpful'):
        return 'Warm Contact'

    # Replied once
    if they_replied and total_exchanges <= 2:
        return 'Replied Once'

    # I sent but no reply
    if i_sent and not they_replied:
        if days_since_contact and days_since_contact > 30:
            return 'Dormant'
        if days_since_contact and days_since_contact > 7:
            return 'Follow-Up Needed'
        return 'Initial Outreach Sent'

    # They initiated but no reply from me (unlikely but handle)
    if they_sent and not i_sent:
        return 'Follow-Up Needed'

    # Connected but nothing meaningful
    if msg_count <= 1:
        return 'Connected'

    return 'Cold / No Action'


# ── Tone Analysis ─────────────────────────────────────────────────────────────

def analyze_tone(messages_text: str):
    """Returns tone string: warm / encouraging / helpful / neutral / transactional / dismissive"""
    text = messages_text.lower()

    dismissive = sum(1 for s in DISMISSIVE_MESSAGE_SIGNALS if s in text)
    if dismissive >= 1:
        return 'dismissive'

    warm = sum(1 for s in WARM_MESSAGE_SIGNALS if s in text)
    encouraging = sum(1 for s in ENCOURAGING_MESSAGE_SIGNALS if s in text)

    if warm >= 3 or (warm >= 1 and encouraging >= 1):
        return 'warm'
    if encouraging >= 2:
        return 'encouraging'
    if warm >= 1:
        return 'helpful'

    # Check for transactional (short, one-liner replies)
    lines = [l.strip() for l in messages_text.split('\n') if l.strip()]
    if len(lines) <= 3 and all(len(l) < 100 for l in lines):
        return 'transactional'

    return 'neutral'


# ── Promise Detection ─────────────────────────────────────────────────────────

def detect_promise(messages_text: str, me: str, msgs: list):
    """
    Detect if they made a promise. Returns (promise_made, promise_text, promise_status).
    Only looks at THEIR messages for promises.
    """
    their_text = ' '.join(
        m.get('CONTENT', '') for m in msgs
        if m.get('FROM', '').strip() != me and m.get('FROM', '').strip() != 'LinkedIn Member'
    ).lower()

    for signal, promise_type in PROMISE_SIGNALS:
        if signal in their_text:
            # Try to extract the sentence containing the promise
            for sent in re.split(r'[.!?]', their_text):
                if signal in sent:
                    promise_text = sent.strip()[:200]
                    break
            else:
                promise_text = promise_type

            # Status: if conversation is still active → pending; if dormant → abandoned
            return True, f"{promise_type}: {promise_text}", 'pending'

    return False, None, None


# ── POC Scoring ───────────────────────────────────────────────────────────────

def compute_poc_score(they_replied, two_way, total_exchanges, tone, referral_discussed,
                      referral_secured, persona, hiring_process_related, promise_made,
                      days_since_contact):
    score = 0

    if two_way:
        score += 3
    elif they_replied:
        score += 1

    if tone in ('warm', 'encouraging'):
        score += 2
    elif tone == 'helpful':
        score += 1

    if referral_secured:
        score += 3
    elif referral_discussed:
        score += 2

    if promise_made:
        score += 1

    if hiring_process_related:
        score += 1

    if persona in ('Hiring Manager', 'Recruiter'):
        score += 1

    if total_exchanges >= 6:
        score += 1

    # Recency bonus
    if days_since_contact is not None:
        if days_since_contact < 30:
            score += 1
        elif days_since_contact > 180:
            score -= 1

    return max(0, min(10, score))


# ── Relationship Strength ─────────────────────────────────────────────────────

def compute_relationship_strength(poc_score, two_way, tone, referral_secured, referral_discussed):
    if referral_secured or poc_score >= 8:
        return 'Confirmed POC'
    if poc_score >= 6:
        return 'POC Candidate'
    if poc_score >= 4 or (two_way and tone in ('warm', 'encouraging', 'helpful')):
        return 'Strong'
    if poc_score >= 2 or two_way:
        return 'Warm'
    if poc_score >= 1:
        return 'Informational'
    return 'Low'


# ── Follow-Up Intelligence ────────────────────────────────────────────────────

def compute_follow_up(stage, tone, days_since_contact, promise_made, promise_status,
                      two_way, relationship_strength, persona):
    """
    Returns (follow_up_needed, priority, type, reason, timing, guidance)
    """
    d = days_since_contact or 999

    # Cases where no follow-up is needed
    if stage in ('Referral Secured', 'Cold / No Action', 'Not Connected'):
        if stage == 'Cold / No Action' and d > 90:
            return (False, 'none', 'none',
                    'Conversation went cold — no recent signal to act on.',
                    'when ready', 'Only reach out if you have a specific new reason.')
        if stage == 'Referral Secured':
            return (False, 'none', 'none',
                    'Referral secured — relationship is confirmed.',
                    'when ready', 'Send a thank-you and update them on your progress.')
        return (False, 'none', 'none', None, None, None)

    # Promise pending → urgent
    if promise_made and promise_status == 'pending' and d > 7:
        return (True, 'urgent', 'ask-update',
                f'They made a promise ({promise_status}) and {d} days have passed without resolution.',
                'within 24h',
                'Keep it brief and warm. Reference what they offered. Don\'t be pushy. '
                'One sentence check-in: "Just wanted to follow up on your note about [X] — happy to provide anything you need."')

    # Hiring process stalled
    if stage == 'Hiring Process Related' and d > 14:
        return (True, 'urgent', 'ask-update',
                'You were in a hiring conversation and it went quiet.',
                'within 24h',
                'Be direct but professional: "Wanted to check on the status of [role] — '
                'still very interested and happy to provide any additional info."')

    # Referral requested, no update
    if stage == 'Referral Requested' and d > 10:
        return (True, 'high', 'ask-update',
                'A referral was being discussed and the conversation went silent.',
                '3 days',
                'Short and grateful: "Just circling back in case this got buried — '
                'still very excited about [company]. Happy to make it easy for you."')

    # Initial outreach sent, no reply
    if stage == 'Initial Outreach Sent' and d > 7 and d < 60:
        return (True, 'high', 'reminder',
                'You sent the first message and got no reply.',
                '3 days',
                'One clean follow-up only. Restate your ask in one sentence. '
                'Don\'t apologize for following up. If still no reply after this, let it go.')

    # Awaiting reply after warm conversation
    if stage in ('Active Conversation', 'Warm Contact', 'Replied Once') and d > 14:
        priority = 'high' if relationship_strength in ('Strong', 'POC Candidate', 'Confirmed POC') else 'medium'
        return (True, priority, 'check-in',
                f'The conversation was warm/active but went quiet {d} days ago.',
                '1 week' if priority == 'high' else '2 weeks',
                'Don\'t re-ask the same thing. Add new context: a recent achievement, '
                'a new application, or something specific to their company. '
                'Keep it to 2-3 sentences max.')

    # Dormant but revivable (good relationship, quiet)
    if stage == 'Dormant' and relationship_strength in ('Warm', 'Strong', 'POC Candidate'):
        return (True, 'medium', 're-engage',
                f'Strong past connection that went dormant ({d} days since last contact).',
                '2 weeks',
                'Re-engage with a new angle — a milestone, new company application, '
                'or genuine question about their work. Don\'t reference the old conversation '
                'as if it just happened.')

    # Strong rapport, no recent nurture
    if stage == 'Strong Rapport' and d > 30:
        return (True, 'low', 'nurture',
                'Strong relationship but not nurtured recently.',
                '2 weeks',
                'Quick check-in. Share a win or ask for advice. '
                'This relationship is warm — maintain it without a specific ask.')

    # Follow-up needed flag from stage
    if stage == 'Follow-Up Needed':
        return (True, 'medium', 'reminder',
                'Conversation signals suggest a follow-up is appropriate.',
                '1 week',
                'Review the last message before reaching out. Match their tone and energy.')

    return (False, 'none', 'none', None, None, None)


# ── CRM Summary Generation ────────────────────────────────────────────────────

def generate_crm_summary(name, persona, stage, relationship_strength, tone,
                          they_replied, two_way, total_exchanges,
                          referral_discussed, referral_secured, promise_made, promise_text,
                          hiring_process_related, poc_score, follow_up_needed,
                          follow_up_type, follow_up_reason, days_since_contact,
                          first_msg_preview, last_msg_preview):
    parts = []

    # Who they are
    parts.append(f"{name} is a {persona or 'contact'} ({relationship_strength} relationship).")

    # What happened
    if not they_replied:
        parts.append("Sent outreach — no reply received.")
    elif two_way and total_exchanges >= 3:
        parts.append(f"Active {total_exchanges}-exchange conversation. Tone: {tone}.")
    elif they_replied:
        parts.append(f"Replied once. Tone: {tone}.")

    # Referral / promise
    if referral_secured:
        parts.append("Referral secured — they forwarded your profile or provided a direct referral.")
    elif referral_discussed:
        parts.append("Referral was discussed.")
    if promise_made and promise_text:
        parts.append(f"Promise made: {promise_text[:150]}.")

    # Hiring process
    if hiring_process_related:
        parts.append("Conversation involved a hiring process or active application.")

    # Stage
    parts.append(f"Current stage: {stage}.")

    # POC assessment
    if poc_score >= 7:
        parts.append(f"POC Score: {poc_score}/10 — high-value relationship to maintain.")
    elif poc_score >= 4:
        parts.append(f"POC Score: {poc_score}/10 — solid networking contact.")
    elif poc_score >= 1:
        parts.append(f"POC Score: {poc_score}/10 — limited engagement so far.")

    # Follow-up
    if follow_up_needed:
        parts.append(f"Action needed: {follow_up_type} ({follow_up_reason})" if follow_up_reason else f"Action needed: {follow_up_type}.")

    # Recency
    if days_since_contact is not None:
        parts.append(f"Last contact: {days_since_contact} days ago.")

    return " ".join(parts)


# ── Tags Generation ───────────────────────────────────────────────────────────

def generate_tags(persona, stage, tone, referral_discussed, referral_secured,
                  hiring_process_related, promise_made, two_way, poc_score,
                  is_poc_candidate, is_confirmed_poc, follow_up_priority):
    tags = []
    if persona and persona != 'Unknown':
        tags.append(persona.lower().replace(' ', '-'))
    if is_confirmed_poc:
        tags.append('confirmed-poc')
    elif is_poc_candidate:
        tags.append('poc-candidate')
    if referral_secured:
        tags.append('referral-secured')
    elif referral_discussed:
        tags.append('referral-discussed')
    if hiring_process_related:
        tags.append('hiring-loop')
    if promise_made:
        tags.append('promise-pending')
    if two_way:
        tags.append('two-way')
    if tone in ('warm', 'encouraging'):
        tags.append('warm')
    elif tone == 'dismissive':
        tags.append('dismissed')
    if follow_up_priority in ('urgent', 'high'):
        tags.append('high-priority')
    if stage == 'Strong Rapport':
        tags.append('strong-rapport')
    if stage == 'Dormant':
        tags.append('dormant')
    return ','.join(tags)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='LinkedIn DM Intelligence Analysis v2')
    parser.add_argument('--zip', required=True, help='Path to LinkedIn export .zip file')
    parser.add_argument('--dry-run', action='store_true', help='Print without writing to Supabase')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of contacts processed')
    args = parser.parse_args()

    zip_path = os.path.expanduser(args.zip)
    if not os.path.exists(zip_path):
        print(f"Error: file not found: {zip_path}", file=sys.stderr)
        sys.exit(1)

    if not args.dry_run and (not SUPABASE_URL or not SUPABASE_KEY):
        print("Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local", file=sys.stderr)
        sys.exit(1)

    # ── Read messages.csv ─────────────────────────────────────────────────────
    print("Reading messages.csv from zip...")
    with zipfile.ZipFile(zip_path, 'r') as z:
        names = z.namelist()
        msg_file = next((n for n in names if n.lower() == 'messages.csv' or n.lower().endswith('/messages.csv')), None)
        if not msg_file:
            print("Error: messages.csv not found in zip", file=sys.stderr)
            sys.exit(1)
        raw = z.read(msg_file).decode('utf-8', errors='replace')

    all_rows = list(csv.DictReader(io.StringIO(raw)))
    if not all_rows:
        print("No messages found.")
        return

    # ── Detect account owner ──────────────────────────────────────────────────
    from collections import Counter
    me = Counter(r['FROM'] for r in all_rows if r['FROM'] != 'LinkedIn Member').most_common(1)[0][0]
    print(f"Account owner: {me}")

    # ── Group by conversation ─────────────────────────────────────────────────
    convos = defaultdict(list)
    for r in all_rows:
        convos[r['CONVERSATION ID']].append(r)

    print(f"Total conversations: {len(convos)}")

    # ── Process each conversation ─────────────────────────────────────────────
    contacts_by_key = {}  # key = linkedin_url or name

    for conv_id, msgs in convos.items():
        msgs.sort(key=lambda m: parse_date(m['DATE']) or datetime.min.replace(tzinfo=timezone.utc))

        # Find the other participant
        other_name = None
        other_url = None
        for m in msgs:
            if m['FROM'] and m['FROM'].strip() != me and m['FROM'].strip() != 'LinkedIn Member':
                other_name = m['FROM'].strip()
                other_url = (m.get('SENDER PROFILE URL') or '').strip() or None
                break
        if not other_name:
            for m in msgs:
                for i, name in enumerate(m.get('TO', '').split(',')):
                    name = name.strip()
                    urls = m.get('RECIPIENT PROFILE URLS', '').split(',')
                    url = (urls[i].strip() if i < len(urls) else '').strip()
                    if name and name != me and name != 'LinkedIn Member':
                        other_name = name
                        other_url = url or None
                        break
                if other_name:
                    break
        if not other_name:
            continue

        # ── Basic metadata ────────────────────────────────────────────────────
        dates = [parse_date(m['DATE']) for m in msgs]
        dates = [d for d in dates if d]
        last_dt = max(dates) if dates else None
        first_dt = min(dates) if dates else None
        last_contact_str = last_dt.strftime('%Y-%m-%d') if last_dt else None
        days = days_since(last_dt)

        title = (msgs[0].get('CONVERSATION TITLE') or '').strip()

        # Message content
        all_content = [m.get('CONTENT', '').strip() for m in msgs]
        messages_text = '\n'.join(c for c in all_content if c)

        first_content = next((c for c in all_content if c), '')
        last_content = next((c for c in reversed(all_content) if c), '')

        first_msg_preview = first_content[:400] if first_content else None
        last_msg_preview = last_content[:400] if last_content else None

        # ── Conversation direction ────────────────────────────────────────────
        my_msgs = [m for m in msgs if m.get('FROM', '').strip() == me]
        their_msgs = [m for m in msgs if m.get('FROM', '').strip() != me and m.get('FROM', '').strip() != 'LinkedIn Member']

        i_sent_first = bool(my_msgs) and (not their_msgs or (parse_date(my_msgs[0]['DATE']) or datetime.min.replace(tzinfo=timezone.utc)) < (parse_date(their_msgs[0]['DATE']) or datetime.max.replace(tzinfo=timezone.utc)))
        they_replied = len(their_msgs) > 0
        two_way = len(my_msgs) > 0 and len(their_msgs) > 0
        total_exchanges = min(len(my_msgs), len(their_msgs))  # back-and-forth turns

        # ── Analyses ─────────────────────────────────────────────────────────
        tone = analyze_tone(messages_text)
        promise_made, promise_text, promise_status = detect_promise(messages_text, me, msgs)

        # Referral signals
        combined_lower = messages_text.lower()
        referral_discussed = any(s in combined_lower for s in [
            'referral', 'refer you', 'pass along', 'forward your', 'put in a word',
            'internal referral', 'employee referral', 'i can refer', 'submit your',
        ])
        referral_secured = any(s in combined_lower for s in [
            'submitted your', 'i\'ve referred', 'i have referred', 'sent your profile',
            'passed along your', 'forwarded your', 'referred you', 'put in the referral',
        ])
        hiring_process_related = any(s in combined_lower for s in HIRING_PROCESS_SIGNALS)

        # Persona
        position = None  # Not available at this stage; inferred from conversation
        persona, persona_confidence = classify_persona(
            other_name, position, title, messages_text, other_url or ''
        )

        # POC score
        poc_score = compute_poc_score(
            they_replied, two_way, total_exchanges, tone,
            referral_discussed, referral_secured, persona,
            hiring_process_related, promise_made, days
        )

        relationship_strength = compute_relationship_strength(
            poc_score, two_way, tone, referral_secured, referral_discussed
        )

        is_poc_candidate = poc_score >= 5
        is_confirmed_poc = referral_secured or poc_score >= 8

        # Conversation stage
        stage = classify_stage(
            msgs, me, they_replied, two_way, total_exchanges,
            referral_secured, promise_made, hiring_process_related, days, tone
        )

        # Map stage → legacy conv_status for backward compat
        stage_to_status = {
            'Referral Secured':      'Opportunity Active',
            'Hiring Process Related':'Opportunity Active',
            'Strong Rapport':        'Opportunity Active',
            'Active Conversation':   'Opportunity Active',
            'Warm Contact':          'Replied',
            'Replied Once':          'Replied',
            'Referral Requested':    'Follow-Up Needed',
            'Follow-Up Needed':      'Follow-Up Needed',
            'Initial Outreach Sent': 'Awaiting Reply',
            'Dormant':               'Cold / No Action',
            'Cold / No Action':      'Cold / No Action',
            'Connected':             'Cold / No Action',
            'Not Connected':         'Cold / No Action',
        }
        conv_status = stage_to_status.get(stage, 'Cold / No Action')

        # Follow-up intelligence
        (follow_up_needed, fu_priority, fu_type,
         fu_reason, fu_timing, fu_guidance) = compute_follow_up(
            stage, tone, days, promise_made, promise_status,
            two_way, relationship_strength, persona
        )

        # Role type mapping (for backward compat UI filter)
        persona_to_role = {
            'Recruiter':       'Recruiter',
            'Hiring Manager':  'Hiring Manager',
            'Executive':       'Executive',
            'Referral Contact':'Referral Contact',
            'Alumni':          'Alumni',
            'Senior Engineer': 'Peer Engineer',
            'Peer Engineer':   'Peer Engineer',
            'Potential Mentor':'Peer Engineer',
            'Unknown':         'Unknown',
        }
        role_type = persona_to_role.get(persona, 'Unknown')

        # Priority (1-10)
        priority_map = {'urgent': 9, 'high': 7, 'medium': 5, 'low': 3, 'none': 1}
        base_priority = priority_map.get(fu_priority, 1)
        priority = max(1, min(10, base_priority + (poc_score // 2)))

        # CRM summary
        crm_summary = generate_crm_summary(
            other_name, persona, stage, relationship_strength, tone,
            they_replied, two_way, total_exchanges,
            referral_discussed, referral_secured, promise_made, promise_text,
            hiring_process_related, poc_score, follow_up_needed,
            fu_type, fu_reason, days, first_msg_preview, last_msg_preview
        )

        # Legacy summary (conversation title or snippet)
        summary = title if title else (first_content[:200] if first_content else None)

        # Tags
        tags = generate_tags(
            persona, stage, tone, referral_discussed, referral_secured,
            hiring_process_related, promise_made, two_way, poc_score,
            is_poc_candidate, is_confirmed_poc, fu_priority
        )

        # Next action (human-readable)
        if fu_type and fu_type != 'none':
            fu_type_labels = {
                'reminder':    'Send follow-up reminder',
                'thank-you':   'Send thank-you message',
                'check-in':    'Send a check-in message',
                'ask-update':  'Ask for status update',
                're-engage':   'Re-engage dormant contact',
                'nurture':     'Nurture the relationship',
            }
            next_action = fu_type_labels.get(fu_type, fu_type)
            if fu_timing:
                next_action += f" ({fu_timing})"
        else:
            next_action = None

        contact = {
            'id':                   make_id(other_name, other_url or ''),
            'name':                 other_name,
            'linkedin_url':         other_url,
            'last_contact':         last_contact_str,
            'days_since':           days,
            'message_count':        len(msgs),
            'summary':              summary,
            # Backward-compat fields
            'role_type':            role_type,
            'conv_status':          conv_status,
            'follow_up':            follow_up_needed,
            'priority':             priority,
            'next_action':          next_action,
            # Intelligence fields
            'persona':              persona,
            'persona_confidence':   persona_confidence,
            'conversation_stage':   stage,
            'relationship_strength':relationship_strength,
            'i_sent_first':         i_sent_first,
            'they_replied':         they_replied,
            'two_way_conversation': two_way,
            'total_exchanges':      total_exchanges,
            'tone':                 tone,
            'referral_discussed':   referral_discussed,
            'referral_secured':     referral_secured,
            'hiring_process_related':hiring_process_related,
            'promise_made':         promise_made,
            'promise_text':         promise_text,
            'promise_status':       promise_status,
            'poc_score':            poc_score,
            'is_poc_candidate':     is_poc_candidate,
            'is_confirmed_poc':     is_confirmed_poc,
            'follow_up_priority':   fu_priority,
            'follow_up_type':       fu_type,
            'follow_up_reason':     fu_reason,
            'follow_up_timing':     fu_timing,
            'follow_up_guidance':   fu_guidance,
            'crm_summary':          crm_summary,
            'tags':                 tags or None,
            'first_message_preview':first_msg_preview,
            'last_message_preview': last_msg_preview,
            'source':               'linkedin_intelligence_v2',
            'company':              None,   # not in messages.csv; preserved from existing DB
            'position':             None,   # not in messages.csv; preserved from existing DB
        }

        key = other_url or other_name
        existing = contacts_by_key.get(key)
        if not existing or (last_contact_str and (not existing['last_contact'] or last_contact_str > existing['last_contact'])):
            contacts_by_key[key] = contact
        else:
            existing['message_count'] += len(msgs)

    # ── Deduplicate on id ─────────────────────────────────────────────────────
    by_id = {}
    for c in contacts_by_key.values():
        existing = by_id.get(c['id'])
        if not existing or (c['last_contact'] and (not existing['last_contact'] or c['last_contact'] > existing['last_contact'])):
            by_id[c['id']] = c
        else:
            existing['message_count'] += c['message_count']

    rows_to_upsert = list(by_id.values())

    # Apply limit for testing
    if args.limit > 0:
        rows_to_upsert = rows_to_upsert[:args.limit]

    # ── Print stats ───────────────────────────────────────────────────────────
    total = len(rows_to_upsert)
    two_way_ct = sum(1 for r in rows_to_upsert if r['two_way_conversation'])
    poc_candidates = sum(1 for r in rows_to_upsert if r['is_poc_candidate'])
    confirmed_pocs = sum(1 for r in rows_to_upsert if r['is_confirmed_poc'])
    warm_contacts = sum(1 for r in rows_to_upsert if r['relationship_strength'] in ('Warm', 'Strong', 'POC Candidate', 'Confirmed POC'))
    recruiters = sum(1 for r in rows_to_upsert if r['persona'] == 'Recruiter')
    hm_contacts = sum(1 for r in rows_to_upsert if r['persona'] == 'Hiring Manager')
    follow_ups = sum(1 for r in rows_to_upsert if r['follow_up'])
    urgent_fus = sum(1 for r in rows_to_upsert if r['follow_up_priority'] == 'urgent')
    referrals = sum(1 for r in rows_to_upsert if r['referral_discussed'])
    ref_secured = sum(1 for r in rows_to_upsert if r['referral_secured'])
    promises = sum(1 for r in rows_to_upsert if r['promise_made'])
    hiring = sum(1 for r in rows_to_upsert if r['hiring_process_related'])

    print(f"\n{'='*60}")
    print(f"  LINKEDIN DM INTELLIGENCE REPORT")
    print(f"{'='*60}")
    print(f"  Total contacts analyzed : {total}")
    print(f"  Two-way conversations   : {two_way_ct}")
    print(f"  Warm/strong contacts    : {warm_contacts}")
    print(f"  POC candidates          : {poc_candidates}")
    print(f"  Confirmed POCs          : {confirmed_pocs}")
    print(f"  Recruiters              : {recruiters}")
    print(f"  Hiring Managers         : {hm_contacts}")
    print(f"  Referral discussed      : {referrals}")
    print(f"  Referral secured        : {ref_secured}")
    print(f"  Promise made            : {promises}")
    print(f"  Hiring process related  : {hiring}")
    print(f"  Follow-ups needed       : {follow_ups}")
    print(f"  Urgent follow-ups       : {urgent_fus}")
    print(f"{'='*60}\n")

    # ── Stage breakdown ───────────────────────────────────────────────────────
    from collections import Counter
    stage_counts = Counter(r['conversation_stage'] for r in rows_to_upsert)
    print("  Stage breakdown:")
    for stage_name, count in sorted(stage_counts.items(), key=lambda x: -x[1]):
        print(f"    {stage_name:<30} {count}")
    print()

    # ── Persona breakdown ─────────────────────────────────────────────────────
    persona_counts = Counter(r['persona'] for r in rows_to_upsert)
    print("  Persona breakdown:")
    for p, count in sorted(persona_counts.items(), key=lambda x: -x[1]):
        print(f"    {p:<30} {count}")
    print()

    # ── Sample high-value contacts ────────────────────────────────────────────
    top = sorted(rows_to_upsert, key=lambda r: -(r['poc_score'] or 0))[:5]
    print("  Top 5 by POC score:")
    for r in top:
        print(f"    [{r['poc_score']}/10] {r['name']:<30} {r['persona']:<20} {r['conversation_stage']}")
    print()

    if args.dry_run:
        print("DRY RUN — no data written to Supabase.")
        # Print a few full records for inspection
        print("\nSample records (first 3):")
        for r in rows_to_upsert[:3]:
            print(f"\n--- {r['name']} ---")
            for k, v in r.items():
                if v is not None and v != '' and v is not False:
                    print(f"  {k}: {v}")
        return

    # ── Upsert to Supabase ────────────────────────────────────────────────────
    print("Writing to Supabase...")
    from supabase import create_client
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Upsert in batches of 50 to avoid payload limits
    batch_size = 50
    written = 0
    for i in range(0, len(rows_to_upsert), batch_size):
        batch = rows_to_upsert[i:i+batch_size]
        # Remove company/position from upsert — preserve whatever's in DB already
        # by not including them if None (Supabase upsert will overwrite with None otherwise)
        # We DO include them because the schema expects them; existing non-null values
        # will be preserved if we use on_conflict with merge_duplicates=False.
        # Since we want to keep existing company/position from prior CRM import,
        # we drop those two fields from the upsert payload.
        clean_batch = []
        for row in batch:
            r = {k: v for k, v in row.items() if k not in ('company', 'position')}
            r['updated_at'] = datetime.now(timezone.utc).isoformat()
            r['user_id'] = 'de1bafab-7e76-4b80-a7ed-8de86c6d9bad'
            clean_batch.append(r)

        client.table('linkedin_dm_contacts').upsert(
            clean_batch, on_conflict='id'
        ).execute()
        written += len(batch)
        print(f"  Written {written}/{len(rows_to_upsert)}...", end='\r')

    print(f"\nDone. {written} contacts enriched and saved to Supabase.")


if __name__ == '__main__':
    main()
