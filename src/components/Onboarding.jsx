import { useState } from 'react';
import * as Storage from '../lib/storage.js';

const DOMAIN_OPTIONS = [
  { value: 'aerospace_manufacturing', label: 'Aerospace & Manufacturing' },
  { value: 'industrial_engineering',  label: 'Industrial & Operations Engineering' },
  { value: 'mechanical_thermal',      label: 'Mechanical & Thermal Engineering' },
];

const VISA_OPTIONS = ['US Citizen', 'Green Card', 'H-1B', 'OPT/STEM OPT', 'Other'];
const DEGREE_OPTIONS = ['B.S.', 'M.S.', 'Ph.D.', 'B.E.', 'M.E.'];

// Pre-filled role target suggestions per domain family
const DOMAIN_ROLE_SUGGESTIONS = {
  aerospace_manufacturing: [
    { title: 'Manufacturing Engineer', cluster: 'core_manufacturing', priority: 1 },
    { title: 'Aerospace Systems Engineer', cluster: 'core_manufacturing', priority: 1 },
    { title: 'Propulsion Engineer', cluster: 'startup_manufacturing', priority: 2 },
    { title: 'Production Engineer', cluster: 'core_manufacturing', priority: 2 },
  ],
  industrial_engineering: [
    { title: 'Industrial Engineer', cluster: 'industrial_operations', priority: 1 },
    { title: 'Operations Engineer', cluster: 'industrial_operations', priority: 1 },
    { title: 'Supply Chain Engineer', cluster: 'industrial_operations', priority: 2 },
    { title: 'Process Engineer', cluster: 'industrial_operations', priority: 2 },
  ],
  mechanical_thermal: [
    { title: 'Mechanical Engineer', cluster: 'mechanical_thermal', priority: 1 },
    { title: 'Thermal Systems Engineer', cluster: 'mechanical_thermal', priority: 1 },
    { title: 'Systems Engineer', cluster: 'mechanical_thermal', priority: 2 },
    { title: 'R&D Engineer', cluster: 'mechanical_thermal', priority: 2 },
  ],
};

const STEPS = ['Profile', 'Target Roles', 'API Keys'];

export default function Onboarding({ t, onComplete }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 0 — Profile
  const [name, setName] = useState('');
  const [degree, setDegree] = useState('M.S.');
  const [visa, setVisa] = useState('OPT/STEM OPT');
  const [domain, setDomain] = useState('aerospace_manufacturing');
  const [linkedinUrl, setLinkedinUrl] = useState('');

  // Step 1 — Role Targets (loaded from suggestions, user can add/remove)
  const [roleTargets, setRoleTargets] = useState(
    DOMAIN_ROLE_SUGGESTIONS['aerospace_manufacturing']
  );
  const [newRoleTitle, setNewRoleTitle] = useState('');

  // Step 2 — API Keys
  const [groqKey, setGroqKey] = useState('');
  const [serperKey, setSerperKey] = useState('');

  const labelStyle = { display: 'block', color: t.sub, fontSize: 12, fontWeight: 600, marginBottom: 6 };
  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${t.border}`, background: t.bg,
    color: t.tx, fontSize: 14, boxSizing: 'border-box',
    marginBottom: 16, fontFamily: 'inherit', outline: 'none',
  };
  const selectStyle = { ...inputStyle, cursor: 'pointer' };

  function handleDomainChange(val) {
    setDomain(val);
    setRoleTargets(DOMAIN_ROLE_SUGGESTIONS[val] || []);
  }

  function removeRoleTarget(idx) {
    setRoleTargets(r => r.filter((_, i) => i !== idx));
  }

  function addRoleTarget() {
    if (!newRoleTitle.trim()) return;
    setRoleTargets(r => [...r, { title: newRoleTitle.trim(), cluster: domain, priority: 3 }]);
    setNewRoleTitle('');
  }

  async function handleFinish() {
    setSaving(true);
    setError('');
    try {
      await Storage.upsertUserProfile({
        full_name: name.trim(),
        degree: degree,
        visa_status: visa,
        domain_family: domain,
        linkedin_url: linkedinUrl.trim() || null,
      });

      if (roleTargets.length > 0) {
        for (const rt of roleTargets) {
          await Storage.upsertRoleTarget({
            title: rt.title,
            cluster: rt.cluster,
            priority: rt.priority,
            keywords: [],
            boost_tags: [],
            require_h1b: visa === 'H-1B' || visa === 'OPT/STEM OPT',
          });
        }
      }

      if (groqKey.trim())   await Storage.saveUserIntegration('groq', groqKey.trim());
      if (serperKey.trim()) await Storage.saveUserIntegration('serper', serperKey.trim());

      onComplete();
    } catch (err) {
      setError(err.message || 'Failed to save profile.');
      setSaving(false);
    }
  }

  function nextStep() {
    if (step === 0 && !name.trim()) { setError('Please enter your name.'); return; }
    if (step === 1 && roleTargets.length === 0) { setError('Add at least one role target.'); return; }
    setError('');
    setStep(s => s + 1);
  }

  return (
    <div style={{
      minHeight: '100vh', background: t.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans','Inter',system-ui,sans-serif",
    }}>
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 16, padding: '40px 36px', width: 460,
        boxShadow: t.shadow,
      }}>
        {/* Header */}
        <h2 style={{ color: t.tx, margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>
          Welcome to JobAgent
        </h2>
        <p style={{ color: t.sub, margin: '0 0 24px', fontSize: 13 }}>
          Let's set up your profile so we can surface the right jobs for you.
        </p>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {STEPS.map((label, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                height: 4, borderRadius: 2, marginBottom: 6,
                background: i <= step ? t.pri : t.border,
                transition: 'background .2s',
              }} />
              <span style={{ fontSize: 11, color: i === step ? t.pri : t.muted, fontWeight: i === step ? 700 : 400 }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step 0: Profile */}
        {step === 0 && (
          <>
            <label style={labelStyle}>Full Name</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              style={inputStyle} placeholder="Jane Smith" autoFocus
            />

            <label style={labelStyle}>Highest Degree</label>
            <select value={degree} onChange={e => setDegree(e.target.value)} style={selectStyle}>
              {DEGREE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <label style={labelStyle}>Visa / Work Authorization</label>
            <select value={visa} onChange={e => setVisa(e.target.value)} style={selectStyle}>
              {VISA_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>

            <label style={labelStyle}>Engineering Domain</label>
            <select value={domain} onChange={e => handleDomainChange(e.target.value)} style={selectStyle}>
              {DOMAIN_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>

            <label style={labelStyle}>LinkedIn URL (optional)</label>
            <input
              type="text" value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)}
              style={inputStyle} placeholder="https://linkedin.com/in/yourprofile"
            />
          </>
        )}

        {/* Step 1: Role Targets */}
        {step === 1 && (
          <>
            <p style={{ color: t.sub, fontSize: 13, margin: '0 0 16px' }}>
              These are pre-filled based on your domain. Add or remove as you like.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {roleTargets.map((rt, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: '8px 12px',
                }}>
                  <span style={{ color: t.tx, fontSize: 13 }}>{rt.title}</span>
                  <button
                    onClick={() => removeRoleTarget(i)}
                    style={{ background: 'none', border: 'none', color: t.red, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text" value={newRoleTitle} onChange={e => setNewRoleTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addRoleTarget()}
                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                placeholder="Add a custom role title…"
              />
              <button
                onClick={addRoleTarget}
                style={{
                  padding: '10px 16px', borderRadius: 8, border: 'none',
                  background: t.pri, color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >Add</button>
            </div>
          </>
        )}

        {/* Step 2: API Keys */}
        {step === 2 && (
          <>
            <p style={{ color: t.sub, fontSize: 13, margin: '0 0 16px' }}>
              Optional — you can skip these and add them later in Settings.
            </p>

            <label style={labelStyle}>Groq API Key (for AI analysis)</label>
            <input
              type="password" value={groqKey} onChange={e => setGroqKey(e.target.value)}
              style={inputStyle} placeholder="gsk_…" autoFocus
            />

            <label style={labelStyle}>Serper API Key (for company research)</label>
            <input
              type="password" value={serperKey} onChange={e => setSerperKey(e.target.value)}
              style={inputStyle} placeholder="Your Serper key"
            />

            <p style={{ color: t.muted, fontSize: 11, margin: '4px 0 16px' }}>
              Keys are stored per-user in your Supabase account and never shared.
            </p>
          </>
        )}

        {/* Error */}
        {error && (
          <p style={{ color: t.red, fontSize: 13, margin: '0 0 14px' }}>{error}</p>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 0 && (
            <button
              onClick={() => { setError(''); setStep(s => s - 1); }}
              style={{
                flex: 1, padding: '11px', borderRadius: 8,
                background: 'transparent', color: t.sub,
                border: `1px solid ${t.border}`, fontSize: 14, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Back</button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              onClick={nextStep}
              style={{
                flex: 2, padding: '11px', borderRadius: 8,
                background: t.pri, color: '#fff', border: 'none',
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Continue</button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saving}
              style={{
                flex: 2, padding: '11px', borderRadius: 8,
                background: t.pri, color: '#fff', border: 'none',
                fontSize: 14, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
              }}
            >{saving ? 'Saving…' : 'Finish Setup'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
