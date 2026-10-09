'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';
import { PasswordInput, Spinner } from '../../components/ui';

// No sign-up here on purpose: the System Administrator creates every account in
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
        ? 'This account has been deactivated. Please contact the System Administrator.'
        : error.message);
      setLoading(false);
      return;
    }
    // Once the profile loads, the app shell sends the person on: to the
    // password change screen on first login, otherwise to their home page.
    const profile = await refreshProfile();
    if (!profile) {
      setError('This account has no access. Please contact the System Administrator.');
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/brand/odyssey-vertical.svg" alt="ODYSSEY" className="logo-light" />
            <img src="/brand/odyssey-vertical-on-dark.svg" alt="ODYSSEY" className="logo-dark" />
          </div>
          <p className="auth-subtitle">Sign in to continue</p>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && <p className="alert alert-danger">{error}</p>}

            <button type="submit" disabled={loading} className="btn btn-block" style={{ marginTop: 8 }}>
              {loading ? <><Spinner /> Signing in…</> : 'Sign in'}
            </button>
          </form>

          <p className="muted small" style={{ marginTop: 20, marginBottom: 0, textAlign: 'center' }}>
            No account yet? Accounts are created by the firm&apos;s System Administrator.
          </p>
        </div>
        <p className="auth-footer">Oroceo, Dimandal &amp; Co. CPAs</p>
      </div>
    </div>
  );
}
