import { supabase } from '../supabase.js';

// ── Field sanitizer — maps camelCase JS fields to snake_case Supabase columns ─
function sanitizeJob(job) {
  return {
    id: String(job.id),
    role: job.role || null,
    company: job.company || null,
    location: job.location || null,
    type: job.type || null,
    link: job.link || null,
    posted: job.posted ? String(job.posted) : null,
    itar_flag: job.itar_flag || false,
    itar_detail: job.itar_detail || null,
    tier: job.tier ? String(job.tier) : null,
    h1b: job.h1b || null,
    industry: job.industry || null,
    reason: job.reason || null,
    match: job.match != null ? parseInt(job.match) || null : null,
    verdict: job.verdict || null,
    source: job.source || null,
    jd: job.jd || null,
    analysis_result: job.analysisResult || job.analysis_result || null,
    location_type: job.locationType || job.location_type || null,
    salary: job.salary || null,
    resume_variant: job.resumeVariant || job.resume_variant || null,
    in_pipeline: job.in_pipeline || false,
    pipeline_added_at: job.in_pipeline ? (job.pipeline_added_at || new Date().toISOString()) : null,
  };
}

function sanitizeApplication(app) {
  return {
    id: String(app.id),
    role: app.role || null,
    company: app.company || null,
    location: app.location || null,
    link: app.link || null,
    company_link: app.companyLink || app.company_link || null,
    match: app.match != null ? parseInt(app.match) || null : null,
    verdict: app.verdict || null,
    status: app.status || 'Applied',
    date: app.date || null,
    location_type: app.locationType || app.location_type || null,
    type: app.type || null,
    salary: app.salary || null,
    resume_variant: app.resumeVariant || app.resume_variant || null,
    fit_level: app.fitLevel || app.fit_level || null,
  };
}

// Restore JS shape from DB row
export function hydrateJob(row) {
  return {
    ...row,
    analysisResult: row.analysis_result,
    locationType: row.location_type,
    resumeVariant: row.resume_variant,
    companyLink: row.company_link,
  };
}

export function hydrateApplication(row) {
  return {
    ...row,
    companyLink: row.company_link || '',
    locationType: row.location_type || '',
    resumeVariant: row.resume_variant || '',
    fitLevel: row.fit_level || '',
  };
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
export async function fetchJobs() {
  const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(hydrateJob);
}

export async function upsertJob(job) {
  const { error } = await supabase.from('jobs').upsert(sanitizeJob(job), { onConflict: 'id' });
  if (error) throw error;
}

export async function upsertJobs(jobs) {
  if (!jobs.length) return;
  const sanitized = jobs.map(sanitizeJob);
  // Batch in chunks of 50 to avoid payload limits
  for (let i = 0; i < sanitized.length; i += 50) {
    const { error } = await supabase.from('jobs').upsert(sanitized.slice(i, i + 50), { onConflict: 'id' });
    if (error) throw error;
  }
}

export async function deleteJob(id) {
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) throw error;
}

// ── Applications ──────────────────────────────────────────────────────────────
export async function fetchApplications() {
  const { data, error } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(hydrateApplication);
}

export async function upsertApplication(app) {
  const { error } = await supabase.from('applications').upsert(sanitizeApplication(app), { onConflict: 'id' });
  if (error) throw error;
}

// ── Networking Log ────────────────────────────────────────────────────────────
export async function fetchNetlog() {
  const { data, error } = await supabase.from('netlog').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertNetlog(entry) {
  const clean = {
    id: String(entry.id),
    date: entry.date || null,
    name: entry.name || null,
    type: entry.type || null,
    company: entry.company || null,
    role: entry.role || null,
    email: entry.email || null,
    linkedin_url: entry.linkedinUrl || entry.linkedin_url || null,
  };
  const { error } = await supabase.from('netlog').upsert(clean, { onConflict: 'id' });
  if (error) throw error;
}

// ── Templates ─────────────────────────────────────────────────────────────────
export async function fetchTemplates() {
  const { data, error } = await supabase.from('templates').select('*');
  if (error) throw error;
  return data || [];
}

export async function upsertTemplate(template) {
  const { error } = await supabase.from('templates').upsert(template, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
}

// ── Settings (key-value, used for currentJob + theme) ─────────────────────────
export async function fetchSettings() {
  const { data, error } = await supabase.from('settings').select('*');
  if (error) throw error;
  const result = {};
  (data || []).forEach(row => { result[row.key] = row.value; });
  return result;
}

export async function saveSetting(key, value) {
  const { error } = await supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export async function saveCurrentJob(job) {
  const { error } = await supabase.from('settings').upsert(
    { key: 'current_job', value: JSON.stringify(job) },
    { onConflict: 'key' }
  );
  if (error) throw error;
}

export async function loadCurrentJob() {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'current_job').maybeSingle();
  if (error || !data) return null;
  try { return JSON.parse(data.value); } catch { return null; }
}

// ── LinkedIn DM Contacts ───────────────────────────────────────────────────────
export async function fetchLinkedInContacts() {
  const { data, error } = await supabase
    .from('linkedin_dm_contacts')
    .select('*')
    .order('priority', { ascending: false })
    .order('last_contact', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchLinkedInFollowups() {
  const { data, error } = await supabase
    .from('linkedin_dm_contacts')
    .select('*')
    .eq('follow_up', true)
    .order('priority', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertLinkedInContact(contact) {
  const row = {
    id:            contact.id,
    name:          contact.name,
    company:       contact.company,
    position:      contact.position,
    role_type:     contact.role_type,
    conv_status:   contact.conv_status,
    last_contact:  contact.last_contact,
    days_since:    contact.days_since,
    message_count: contact.message_count,
    follow_up:     contact.follow_up,
    priority:      contact.priority,
    next_action:   contact.next_action,
    summary:       contact.summary,
    notes:         contact.notes,
    linkedin_url:  contact.linkedin_url,
    email:         contact.email,
    updated_at:    new Date().toISOString(),
  };
  const { error } = await supabase
    .from('linkedin_dm_contacts')
    .upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

export async function updateLinkedInContactNotes(id, notes) {
  const { error } = await supabase
    .from('linkedin_dm_contacts')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
