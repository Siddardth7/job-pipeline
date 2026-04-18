// Run once: node scripts/migrate-netlog-data.js
// Migrates netlog rows + netlog_meta JSON into unified contacts table
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // needs service role to bypass RLS
);

const USER_ID = process.env.JOBAGENT_USER_ID;
if (!USER_ID) throw new Error('JOBAGENT_USER_ID env var required');

async function parseOutreachDate(raw) {
  if (!raw) return null;
  // Handle locale strings like "4/18/2026" or "18/4/2026"
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

async function run() {
  // 1. Fetch all netlog rows
  const { data: netlogs, error: netErr } = await supabase
    .from('netlog').select('*').eq('user_id', USER_ID);
  if (netErr) throw netErr;
  console.log(`Found ${netlogs.length} netlog rows`);

  // 2. Fetch netlog_meta from settings
  const { data: metaRow } = await supabase
    .from('settings').select('value')
    .eq('key', `${USER_ID}:netlog_meta`).maybeSingle();
  let metaMap = {};
  try { metaMap = JSON.parse(metaRow?.value || '{}'); } catch { /* corrupt — ignore */ }
  console.log(`Found ${Object.keys(metaMap).length} netlog_meta entries`);

  // 3. Upsert netlog rows into contacts
  for (const row of netlogs) {
    const meta = metaMap[row.id] || {};
    const outreachDate = await parseOutreachDate(row.date);

    const contact = {
      id: row.id,
      user_id: USER_ID,
      name: row.name,
      company: row.company,
      position: row.role || null,
      linkedin_url: row.linkedin_url || null,
      email: row.email !== 'NA' ? row.email : null,
      source: row.id.startsWith('manual-') ? 'manual' : 'find_contacts',
      outreach_sent: true,
      outreach_date: outreachDate,
      outreach_status: meta.status || 'Sent',
      outreach_status_changed_at: meta.statusChangedAt || null,
    };

    const { error } = await supabase
      .from('contacts')
      .upsert(contact, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      // Try linkedin_url match as fallback
      if (row.linkedin_url) {
        const { data: existing } = await supabase
          .from('contacts').select('id')
          .eq('linkedin_url', row.linkedin_url).eq('user_id', USER_ID).maybeSingle();
        if (existing) {
          await supabase.from('contacts')
            .update({ outreach_sent: true, outreach_date: outreachDate,
                      outreach_status: contact.outreach_status,
                      outreach_status_changed_at: contact.outreach_status_changed_at })
            .eq('id', existing.id);
          console.log(`  Merged via linkedin_url: ${row.name}`);
          continue;
        }
      }
      console.error(`  Failed to migrate ${row.name} (${row.id}):`, error.message);
    } else {
      console.log(`  Migrated: ${row.name}`);
    }
  }

  console.log('Migration complete. Verify counts:');
  const { count } = await supabase.from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', USER_ID).eq('outreach_sent', true);
  console.log(`  contacts with outreach_sent=true: ${count} (expected ~${netlogs.length})`);
}

run().catch(console.error);
