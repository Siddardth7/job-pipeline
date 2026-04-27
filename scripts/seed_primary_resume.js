// One-time seeder: converts the hardcoded candidate block from groq.js into
// a structured_sections row in the resumes table for shhahidmian@gmail.com.
// Run once: node scripts/seed_primary_resume.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TARGET_EMAIL = 'shhahidmian@gmail.com';

const structured_sections = {
  schema_version: 1,
  summary: null,
  section_order: ['skills', 'experience', 'education'],
  skills: [
    { category: 'Quality Engineering', items: ['pFMEA', 'SPC', '8D Root Cause Analysis', 'RCCA', 'CMM Inspection', 'GD&T', 'First Article Inspection', 'MRB Disposition', 'CAPA'] },
    { category: 'Manufacturing & Tooling', items: ['Fixture Design', 'Assembly Sequencing', 'Tooling Qualification', 'CNC Machining', 'Blueprint Reading', 'SolidWorks', 'AutoCAD'] },
    { category: 'Composite Processing', items: ['Prepreg Layup', 'Autoclave Processing', 'Vacuum Bagging', 'Cure Cycle Development', 'Out-of-Autoclave Methods'] },
    { category: 'Simulation & Software', items: ['ABAQUS', 'FEA', 'Classical Lamination Theory', 'MATLAB', 'Python'] },
  ],
  experience: [
    {
      company: 'Tata Boeing Aerospace',
      role: 'Quality Engineering Intern',
      location: 'Hyderabad, India',
      date_range: 'May 2024 – Aug 2024',
      bullets: [
        'Audited GD&T-based CMM inspection records for 450+ flight-critical components to 0.02 mm accuracy, supporting zero customer escapes on GE and Boeing programs.',
        'Initiated 5 Whys root cause investigation and escalated to 8D structured problem-solving for deeper resolution on GE engine component nonconformances, reducing NCR cycle time by 22%.',
        'Implemented SPC-guided corrective actions (revised CNC tool change intervals) reducing position tolerance defect rate from 15% to under 3%.',
        'Built FMEA-based engineering justification for supplier nonconformance enabling use-as-is disposition that prevented ~$3,000 in scrap and 4-week lead time delay.',
      ],
    },
    {
      company: 'SAMPE University Competition',
      role: 'Structures Lead',
      location: 'Urbana, IL',
      date_range: 'Aug 2023 – Apr 2024',
      bullets: [
        'Built 24-inch composite fuselage via prepreg layup and autoclave cure (275°F, lab-limited 40 psi) — part sustained 2,700 lbf at test (2.7× design requirement).',
        'Built pFMEA ranking 5 failure modes (vacuum bag leaks highest, RPN=60) and standardized pressurized hold test protocol at 20 psi achieving zero process deviations.',
        'Optimized laminate stacking using Python simulated annealing + ABAQUS FEA achieving 38% deflection reduction vs baseline.',
      ],
    },
    {
      company: 'Beckman Institute, UIUC',
      role: 'Graduate Research Assistant',
      location: 'Urbana, IL',
      date_range: 'Jan 2024 – May 2024',
      bullets: [
        'Developed and validated out-of-autoclave cure method using frontal polymerization — proof-of-concept compression of composite processing cycle from 8+ hours to under 5 minutes.',
        'Predicted cure behavior within 10% velocity accuracy and 3°C of peak temperatures, accelerating process parameter optimization by 94% through computational modeling.',
      ],
    },
    {
      company: 'EQIC Dies & Moulds',
      role: 'Manufacturing Engineering Intern',
      location: 'Hyderabad, India',
      date_range: 'May 2022 – Jul 2022',
      bullets: [
        'Mapped 12-stage die production workflow identifying inter-stage handoff points as primary sources of dimensional tolerance accumulation.',
        'Verified die component tolerances to ±0.02 mm (GD&T) and confirmed parting surface alignment (>80% contact) on 800-bar HPDC tooling.',
      ],
    },
  ],
  education: [
    { school: 'University of Illinois Urbana-Champaign', degree: 'M.S. Aerospace Engineering', date_range: 'Aug 2023 – Dec 2025', location: 'Urbana, IL' },
  ],
  certifications: ['Six Sigma Green Belt (CSSC)', 'Inspection & Quality Control in Manufacturing'],
};

async function seed() {
  const { data: users, error: userErr } = await supabase.auth.admin.listUsers();
  if (userErr) { console.error('listUsers error:', userErr.message); process.exit(1); }

  const user = users.users.find(u => u.email === TARGET_EMAIL);
  if (!user) { console.error(`User ${TARGET_EMAIL} not found`); process.exit(1); }

  console.log(`Found user: ${user.id}`);

  await supabase.from('resumes').update({ is_primary: false }).eq('user_id', user.id);

  const { error } = await supabase.from('resumes').upsert({
    user_id: user.id,
    name: 'Primary Resume',
    is_primary: true,
    structured_sections,
    updated_at: new Date().toISOString(),
  });

  if (error) { console.error('Upsert error:', error.message); process.exit(1); }
  console.log('✓ Primary resume seeded for', TARGET_EMAIL);
}

seed();
