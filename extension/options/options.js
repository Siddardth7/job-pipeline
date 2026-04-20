// options.js — profile settings page logic

const PROFILE_KEY = 'jobagent_profile';

const DEFAULT_PROFILE = {
  firstName: '', lastName: '', email: '', phone: '',
  linkedinUrl: '', city: '', state: '',
  workAuth: 'authorized', needsSponsorship: true, visaStatus: 'F-1 OPT STEM',
  summary: '', skills_latex: '',
  compilerUrl: 'https://resume-compiler-1077806152183.us-central1.run.app',
  supabaseUrl: 'https://wefcbqfxzvvgremxhubi.supabase.co',
  supabaseAnonKey: '',
};

// All field IDs that map directly to profile keys
const TEXT_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'linkedinUrl', 'city', 'state',
  'visaStatus', 'summary', 'skills_latex',
  'compilerUrl', 'supabaseUrl', 'supabaseAnonKey',
];
const SELECT_FIELDS = ['workAuth', 'needsSponsorship'];

async function loadProfile() {
  const result = await chrome.storage.local.get(PROFILE_KEY);
  const profile = { ...DEFAULT_PROFILE, ...result[PROFILE_KEY] };

  for (const field of TEXT_FIELDS) {
    const el = document.getElementById(field);
    if (el) el.value = profile[field] || '';
  }
  for (const field of SELECT_FIELDS) {
    const el = document.getElementById(field);
    if (el) el.value = String(profile[field]);
  }
}

async function saveProfile() {
  const profile = {};
  for (const field of TEXT_FIELDS) {
    const el = document.getElementById(field);
    if (el) profile[field] = el.value.trim();
  }
  for (const field of SELECT_FIELDS) {
    const el = document.getElementById(field);
    if (el) {
      // needsSponsorship is stored as boolean
      profile[field] = field === 'needsSponsorship' ? el.value === 'true' : el.value;
    }
  }

  const current = await chrome.storage.local.get(PROFILE_KEY);
  const merged = { ...DEFAULT_PROFILE, ...current[PROFILE_KEY], ...profile };
  await chrome.storage.local.set({ [PROFILE_KEY]: merged });

  const status = document.getElementById('save-status');
  status.textContent = '✓ Saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  document.getElementById('btn-save').addEventListener('click', saveProfile);
});
