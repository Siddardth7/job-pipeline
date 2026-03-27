import { useState } from 'react';
import { signIn } from '../lib/auth.js';

export default function Login({ t }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      // useAuth in App.jsx picks up the session change via onAuthStateChange
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: t.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Sans','Inter',system-ui,sans-serif",
    }}>
      <div style={{
        background: t.card,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: '40px 36px',
        width: 360,
        boxShadow: t.shadow,
      }}>
        <h2 style={{ color: t.tx, margin: '0 0 6px', fontSize: 22, fontWeight: 700 }}>
          JobAgent
        </h2>
        <p style={{ color: t.sub, margin: '0 0 28px', fontSize: 13 }}>
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', color: t.sub, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${t.border}`, background: t.bg,
              color: t.tx, fontSize: 14, boxSizing: 'border-box',
              marginBottom: 16, fontFamily: 'inherit', outline: 'none',
            }}
          />

          <label style={{ display: 'block', color: t.sub, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${t.border}`, background: t.bg,
              color: t.tx, fontSize: 14, boxSizing: 'border-box',
              marginBottom: 24, fontFamily: 'inherit', outline: 'none',
            }}
          />

          {error && (
            <p style={{ color: t.red, fontSize: 13, margin: '0 0 16px' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px', borderRadius: 8,
              background: t.pri, color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontFamily: 'inherit',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ color: t.muted, fontSize: 11, margin: '24px 0 0', textAlign: 'center' }}>
          Account access is by invitation only.
        </p>
      </div>
    </div>
  );
}
