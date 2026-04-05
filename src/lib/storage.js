import { supabase } from '../supabase.js';

// ── Auth helper ────────────────────────────────────────────────────────────────
async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ── Field sanitizers ───────────────────────────────────────────────────────────

// Maps camelCase JS job fields → user_job_feed per-user columns
function sanitizeJobFeedUpdate(job) {
  return {
    job_id:               String(job.id),
    user_relevance_score: job.match != null ? parseInt(job.match) || null : null,
    in_pipeline:          job.in_pipeline || false,
    pipeline_added_at:    job.in_pipeline ? (job.pipeline_added_at || new Date().toISOString()) : null,
    analysis_result:      job.analysisResult || job.analysis_result || null,
    resume_variant:       job.resumeVariant || job.resume_variant || null,
    status:               job.in_pipeline ? 'viewed' : (job.status || 'new'),
  };
}

function sanitizeApplication(app) {
  return {
    id:            String(app.id),
    role:          app.role || null,
    company:       app.company || null,
    location:      app.location || null,
    link:          app.link || null,
    company_link:  app.companyLink || app.company_link || null,
    match:         app.match != null ? parseInt(app.match) || null : null,
    verdict:       app.verdict || null,
    status:        app.status || 'Applied',
    date:          app.date || null,
    location_type: app.locationType || app.location_type || null,
    type:          app.type || null,
    salary:        app.salary || null,
    resume_variant: app.resumeVariant || app.resume_variant || null,
    fit_level:     app.fitLevel || app.fit_level || null,
  };
}

// ── Hydrators — restore JS shape from DB rows ──────────────────────────────────

// Converts a user_job_feed + normalized_jobs joined row into the job shape the UI expects
export function hydrateJob(row) {
  return {
    ...row,
    analysisResult: row.analysis_result,
    locationType:   row.location_type,
    resumeVariant:  row.resume_variant,
    companyLink:    row.company_link,
  };
}

export function hydrateApplication(row) {
  return {
    ...row,
    companyLink:   row.company_link   || '',
    locationType:  row.location_type  || '',
    resumeVariant: row.resume_variant || '',
    fitLevel:      row.fit_level      || '',
  };
}

// ── Jobs (reads from user_job_feed ⨯ normalized_jobs) ─────────────────────────
export async function fetchJobs() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('user_job_feed')
    .select(`
      *,
      job:normalized_jobs (
        id, job_title, company_name, job_url, location, posted_date,
        description, source, itar_flag, tier, h1b, industry,
        verdict, relevance_score, boost_tags
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data || []).map(row => ({
    // Core identity
    id:               row.job_id,
    // Normalized job fields — remapped to legacy UI shape
    role:             row.job?.job_title       ?? null,
    company:          row.job?.company_name    ?? null,
    link:             row.job?.job_url         ?? null,
    location:         row.job?.location        ?? null,
    posted:           row.job?.posted_date     ?? null,
    jd:               row.job?.description     ?? null,
    source:           row.job?.source          ?? null,
    itar_flag:        row.job?.itar_flag       ?? false,
    tier:             row.job?.tier            ?? null,
    h1b:              row.job?.h1b             ?? null,
    industry:         row.job?.industry        ?? null,
    verdict:          row.job?.verdict         ?? null,
    // Per-user feed fields
    match:            row.user_relevance_score ?? row.job?.relevance_score ?? null,
    in_pipeline:      row.in_pipeline,
    pipeline_added_at: row.pipeline_added_at,
    analysis_result:  row.analysis_result,
    analysisResult:   row.analysis_result,
    resume_variant:   row.resume_variant,
    resumeVariant:    row.resume_variant,
    status:           row.status,
    locationType:     null,
    _feedId:          row.id,   // internal — feed row PK for targeted updates
  }));
}

// Returns sorted unique date strings (YYYY-MM-DD) for the last 7 days that have feed rows
export async function fetchFeedDates() {
  const userId = await getUserId();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('user_job_feed')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const seen = new Set();
  const dates = [];
  for (const row of (data || [])) {
    const d = row.created_at.slice(0, 10);
    if (!seen.has(d)) { seen.add(d); dates.push(d); }
  }
  return dates;
}

// Returns jobs for a specific date in YYYY-MM-DD format (same shape as fetchJobs())
export async function fetchJobsByDate(dateStr) {
  const userId = await getUserId();
  const start  = `${dateStr}T00:00:00.000Z`;
  const end    = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('user_job_feed')
    .select(`
      *,
      job:normalized_jobs (
        id, job_title, company_name, job_url, location, posted_date,
        description, source, itar_flag, tier, h1b, industry,
        verdict, relevance_score, boost_tags
      )
    `)
    .eq('user_id', userId)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data || []).map(row => ({
    id:               row.job_id,
    role:             row.job?.job_title       ?? null,
    company:          row.job?.company_name    ?? null,
    link:             row.job?.job_url         ?? null,
    location:         row.job?.location        ?? null,
    posted:           row.job?.posted_date     ?? null,
    jd:               row.job?.description     ?? null,
    source:           row.job?.source          ?? null,
    itar_flag:        row.job?.itar_flag       ?? false,
    tier:             row.job?.tier            ?? null,
    h1b:              row.job?.h1b             ?? null,
    industry:         row.job?.industry        ?? null,
    verdict:          row.job?.verdict         ?? null,
    match:            row.user_relevance_score ?? row.job?.relevance_score ?? null,
    in_pipeline:      row.in_pipeline,
    pipeline_added_at: row.pipeline_added_at,
    analysis_result:  row.analysis_result,
    analysisResult:   row.analysis_result,
    resume_variant:   row.resume_variant,
    resumeVariant:    row.resume_variant,
    status:           row.status,
    locationType:     null,
    _feedId:          row.id,
  }));
}

// Updates per-user fields on a job's feed row (in_pipeline, analysis, variant, etc.)
// Does NOT write to normalized_jobs — pipeline owns that table.
export async function upsertJob(job) {
  const userId = await getUserId();
  const feedUpdate = sanitizeJobFeedUpdate(job);
  const { error } = await supabase
    .from('user_job_feed')
    .upsert(
      { ...feedUpdate, user_id: userId },
      { onConflict: 'user_id,job_id' }
    );
  if (error) throw error;
}

// Batch version — updates user_job_feed rows in chunks of 50
export async function upsertJobs(jobs) {
  if (!jobs.length) return;
  const userId = await getUserId();
  const rows = jobs.map(j => ({ ...sanitizeJobFeedUpdate(j), user_id: userId }));
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase
      .from('user_job_feed')
      .upsert(rows.slice(i, i + 50), { onConflict: 'user_id,job_id' });
    if (error) throw error;
  }
}

// Removes a job from this user's feed (does not touch normalized_jobs)
export async function deleteJob(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_job_feed')
    .delete()
    .eq('user_id', userId)
    .eq('job_id', id);
  if (error) throw error;
}

// ── Applications ───────────────────────────────────────────────────────────────
export async function fetchApplications() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(hydrateApplication);
}

export async function upsertApplication(app) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('applications')
    .upsert({ ...sanitizeApplication(app), user_id: userId }, { onConflict: 'id' });
  if (error) throw error;
}

// ── Networking Log ─────────────────────────────────────────────────────────────
export async function fetchNetlog() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('netlog')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  // Hydrate snake_case DB column → camelCase used by UI
  return (data || []).map(row => ({
    ...row,
    linkedinUrl: row.linkedin_url || null,
  }));
}

export async function upsertNetlog(entry) {
  const userId = await getUserId();
  const clean = {
    id:           String(entry.id),
    user_id:      userId,
    date:         entry.date         || null,
    name:         entry.name         || null,
    type:         entry.type         || null,
    company:      entry.company      || null,
    role:         entry.role         || null,
    email:        entry.email        || null,
    linkedin_url: entry.linkedinUrl  || entry.linkedin_url || null,
  };
  const { error } = await supabase.from('netlog').upsert(clean, { onConflict: 'id' });
  if (error) throw error;
}

// ── Templates ──────────────────────────────────────────────────────────────────
export async function fetchTemplates() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function upsertTemplate(template) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('templates')
    .upsert({ ...template, user_id: userId }, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteTemplate(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Settings (per-user key-value — theme, netlog_meta, current_job) ───────────
// Keys are prefixed with `{userId}:` so each user's settings are isolated.
export async function fetchSettings() {
  const userId = await getUserId();
  const prefix = `${userId}:`;
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .like('key', `${prefix}%`);
  if (error) throw error;
  const result = {};
  (data || []).forEach(row => { result[row.key.slice(prefix.length)] = row.value; });
  return result;
}

export async function saveSetting(key, value) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('settings')
    .upsert({ key: `${userId}:${key}`, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export async function saveCurrentJob(job) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('settings')
    .upsert({ key: `${userId}:current_job`, value: JSON.stringify(job) }, { onConflict: 'key' });
  if (error) throw error;
}

export async function loadCurrentJob() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', `${userId}:current_job`)
    .maybeSingle();
  if (error || !data) return null;
  try { return JSON.parse(data.value); } catch { return null; }
}

// ── User Integrations (API keys — replaces settings groq/serper keys) ─────────
export async function fetchUserIntegrations() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('user_integrations')
    .select('service, api_key, is_valid')
    .eq('user_id', userId);
  if (error) throw error;
  const result = {};
  (data || []).forEach(row => { result[row.service] = row.api_key; });
  return result;
}

export async function saveUserIntegration(service, apiKey) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_integrations')
    .upsert(
      { user_id: userId, service, api_key: apiKey },
      { onConflict: 'user_id,service' }
    );
  if (error) throw error;
}

// ── LinkedIn DM Contacts ───────────────────────────────────────────────────────
export async function fetchLinkedInContacts() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('linkedin_dm_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('priority',     { ascending: false })
    .order('last_contact', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchLinkedInFollowups() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('linkedin_dm_contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('follow_up', true)
    .order('priority', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertLinkedInContact(contact) {
  if (!contact.id) throw new Error('upsertLinkedInContact: contact.id is required');
  const userId = await getUserId();
  const row = {
    id:            contact.id,
    user_id:       userId,
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
  if (!id) throw new Error('updateLinkedInContactNotes: id is required');
  const userId = await getUserId();
  const { error } = await supabase
    .from('linkedin_dm_contacts')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function fetchLinkedInStats(contacts) {
  // Compute intelligence metrics from the already-fetched contacts array.
  // Accepts the result of fetchLinkedInContacts() so no extra DB round-trip.
  const c = contacts || [];
  const now = Date.now();

  const twoWay       = c.filter(x => x.two_way_conversation).length;
  const warm         = c.filter(x => ['Warm','Strong','POC Candidate','Confirmed POC'].includes(x.relationship_strength)).length;
  const pocCandidates= c.filter(x => x.is_poc_candidate).length;
  const confirmedPoc = c.filter(x => x.is_confirmed_poc).length;
  const recruiters   = c.filter(x => x.persona === 'Recruiter').length;
  const hiringMgrs   = c.filter(x => x.persona === 'Hiring Manager').length;
  const followUps    = c.filter(x => x.follow_up).length;
  const urgentFu     = c.filter(x => x.follow_up_priority === 'urgent').length;
  const referrals    = c.filter(x => x.referral_discussed).length;
  const refSecured   = c.filter(x => x.referral_secured).length;
  const promises     = c.filter(x => x.promise_made).length;
  const dormant      = c.filter(x => x.conversation_stage === 'Dormant').length;
  const strongRapport= c.filter(x => x.conversation_stage === 'Strong Rapport').length;

  return {
    total:         c.length,
    twoWay,
    warm,
    pocCandidates,
    confirmedPoc,
    recruiters,
    hiringMgrs,
    followUps,
    urgentFu,
    referrals,
    refSecured,
    promises,
    dormant,
    strongRapport,
  };
}

// ── User Profile ───────────────────────────────────────────────────────────────
export async function fetchUserProfile() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertUserProfile(profile) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_profiles')
    .upsert(
      { ...profile, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}

// ── Role Targets ───────────────────────────────────────────────────────────────
export async function fetchRoleTargets() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('role_targets')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('priority');
  if (error) throw error;
  return data || [];
}

export async function upsertRoleTarget(target) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('role_targets')
    .upsert({ ...target, user_id: userId }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRoleTarget(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('role_targets')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Resume Variants ────────────────────────────────────────────────────────────
export async function fetchResumeVariants() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('resume_variants')
    .select('*')
    .eq('user_id', userId)
    .order('variant_key');
  if (error) throw error;
  return data || [];
}

export async function upsertResumeVariant(variant) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('resume_variants')
    .upsert({ ...variant, user_id: userId }, { onConflict: 'user_id,variant_key' });
  if (error) throw error;
}

// ── User Company Targets ───────────────────────────────────────────────────────
export async function fetchUserCompanyTargets() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('user_company_targets')
    .select('*, company:company_intelligence(*)')
    .eq('user_id', userId)
    .order('priority');
  if (error) throw error;
  return data || [];
}

export async function addUserCompanyTarget(companyId, isPrimary = false) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_company_targets')
    .upsert(
      { user_id: userId, company_id: companyId, is_primary: isPrimary },
      { onConflict: 'user_id,company_id' }
    );
  if (error) throw error;
}

export async function addCompanyToIntelligence(company) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('company_intelligence')
    .insert({ ...company, added_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Resumes ────────────────────────────────────────────────────────────────────
const MAX_RESUMES = 5;

export async function fetchResumes() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('resumes')
    .select('id, name, is_primary, target_roles, last_analyzed_at, created_at, updated_at, analysis_report')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchResume(id) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('resumes')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertResume(resume) {
  const userId = await getUserId();
  // Enforce max limit on insert (no id = new resume)
  if (!resume.id) {
    const existing = await fetchResumes();
    if (existing.length >= MAX_RESUMES) {
      throw new Error(`Maximum ${MAX_RESUMES} resumes allowed. Delete one to add another.`);
    }
  }
  const { data, error } = await supabase
    .from('resumes')
    .upsert(
      {
        ...resume,
        user_id:    userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteResume(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('resumes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// Sets is_primary=true for `id`, false for all other user resumes.
export async function setPrimaryResume(id) {
  const userId = await getUserId();
  const { error: clearErr } = await supabase
    .from('resumes')
    .update({ is_primary: false })
    .eq('user_id', userId);
  if (clearErr) throw clearErr;
  const { error: setErr } = await supabase
    .from('resumes')
    .update({ is_primary: true })
    .eq('id', id)
    .eq('user_id', userId);
  if (setErr) throw setErr;
}

export async function saveResumeAnalysis(id, report) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('resumes')
    .update({
      analysis_report:  report,
      last_analyzed_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── User Preferences ───────────────────────────────────────────────────────────
export async function fetchPreferences() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

export async function savePreferences(prefs) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { ...prefs, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}

// ── Custom Company Intel ───────────────────────────────────────────────────────
export async function saveCustomCompanies(companies) {
  return saveSetting('custom_companies', JSON.stringify(companies));
}

export async function loadCustomCompanies() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', `${userId}:custom_companies`)
    .maybeSingle();
  if (error || !data) return [];
  try { return JSON.parse(data.value); } catch { return []; }
}
