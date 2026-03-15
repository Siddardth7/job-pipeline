import { supabase } from '../supabase.js';

// ── Jobs ──────────────────────────────────────────────────────────────────────
export async function fetchJobs() {
  const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertJob(job) {
  const { error } = await supabase.from('jobs').upsert(job, { onConflict: 'id' });
  if (error) throw error;
}

export async function upsertJobs(jobs) {
  if (!jobs.length) return;
  const { error } = await supabase.from('jobs').upsert(jobs, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteJob(id) {
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) throw error;
}

// ── Applications ──────────────────────────────────────────────────────────────
export async function fetchApplications() {
  const { data, error } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertApplication(app) {
  const { error } = await supabase.from('applications').upsert(app, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteApplication(id) {
  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) throw error;
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export async function fetchContacts() {
  const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertContact(contact) {
  const { error } = await supabase.from('contacts').upsert(contact, { onConflict: 'id' });
  if (error) throw error;
}

// ── Networking Log ────────────────────────────────────────────────────────────
export async function fetchNetlog() {
  const { data, error } = await supabase.from('netlog').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertNetlog(entry) {
  const { error } = await supabase.from('netlog').upsert(entry, { onConflict: 'id' });
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

// ── Settings ──────────────────────────────────────────────────────────────────
export async function fetchSettings() {
  const { data, error } = await supabase.from('settings').select('*');
  if (error) throw error;
  const result = {};
  (data || []).forEach(row => { result[row.key] = row.value; });
  return result;
}

export async function saveSetting(key, value) {
  const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}
