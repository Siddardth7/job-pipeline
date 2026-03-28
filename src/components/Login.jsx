import { useState } from 'react';
import { signIn, signUp } from '../lib/auth.js';

export default function Login({ t }) {
  const [mode,     setMode]     = useState('signin'); // 'signin' | 'signup'
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirm('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
        // onAuthStateChange in App.jsx picks up the new session automatically
        // profile === null → triggers Onboarding wizard
      }
    } catch (err) {
      setError(err.message || (mode === 'signin' ? 'Login failed.' : 'Sign up failed.'));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${t.border}`, background: t.bg,
    color: t.tx, fontSize: 14, boxSizing: 'border-box',
    marginBottom: 16, fontFamily: 'inherit', outline: 'none',
  };

  const labelStyle = {
    display: 'block', color: t.sub, fontSize: 12,
    fontWeight: 600, marginBottom: 6,
  };

  return (
    <div style={{
      minHeight: '100vh', background: t.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans','Inter',system-ui,sans-serif",
    }}>
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 16, padding: '40px 36px', width: 380,
        boxShadow: t.shadow,
      }}>
        {/* Header */}
        <h2 style={{ color: t.tx, margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>
          JobAgent
        </h2>
        <p style={{ color: t.sub, margin: '0 0 24px', fontSize: 13 }}>
          {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
        </p>

        {/* Mode toggle */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 24,
          border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden',
        }}>
          {['signin', 'signup'].map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                flex: 1, padding: '8px 0', border: 'none',
                background: mode === m ? t.pri : 'transparent',
                color: mode === m ? '#fff' : t.sub,
                fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {m === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            placeholder="you@example.com"
            style={inputStyle}
          />

          <label style={labelStyle}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            placeholder={mode === 'signup' ? 'Min 8 characters' : ''}
            style={inputStyle}
          />

          {mode === 'signup' && (
            <>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="Re-enter password"
                style={{ ...inputStyle, marginBottom: 24 }}
              />
            </>
          )}

          {mode === 'signin' && (
            <div style={{ marginBottom: 24 }} />
          )}

          {error && (
            <p style={{ color: t.red, fontSize: 13, margin: '-12px 0 16px' }}>{error}</p>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              width: '100%', padding: '11px', borderRadius: 8,
              background: t.pri, color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
            }}
          >
            {loading
              ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
              : (mode === 'signin' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <p style={{ color: t.muted, fontSize: 11, margin: '20px 0 0', textAlign: 'center' }}>
          {mode === 'signup'
            ? "After sign-up you'll complete a quick profile setup."
            : 'First time? Switch to "Create Account" above.'}
        </p>
      </div>
    </div>
  );
}
