'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';

// No sign-up here on purpose: Firm Leadership creates every account in
// Manage Users and gives the person a default password.
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { refreshProfile } = useProfile();
  const supabase = createClient();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message === 'User is banned'
        ? 'This account has been deactivated. Please contact Firm Leadership.'
        : error.message);
      setLoading(false);
      return;
    }
    // Once the profile loads, the app shell sends the person on: to the
    // password change screen on first login, otherwise to their home page.
    const profile = await refreshProfile();
    if (!profile) {
      setError('This account has no access. Please contact Firm Leadership.');
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24, background: 'white', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
      <h1 style={{ marginBottom: 8 }}>ODYSSEY</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Sign in to continue</p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          />
        </div>

        {error && <p style={{ color: 'crimson', marginBottom: 12 }}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: 10, background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          {loading ? 'Please wait...' : 'Sign In'}
        </button>
      </form>

      <p style={{ marginTop: 16, color: '#666', fontSize: 14 }}>
        No account yet? Accounts are created by the firm&apos;s Managing Partner or a Partner.
      </p>
    </div>
  );
}
