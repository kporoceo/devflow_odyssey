'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';
import { homeFor } from '../../lib/roles';
import { missingRules, PASSWORD_EXAMPLE } from '../../lib/password';
import { PasswordInput, PasswordChecklist, Spinner, BackLink } from '../../components/ui';

// Shown automatically on first login (the account still has its default
// password). Anyone can also open it from My Account to change their password.
export default function ChangePassword() {
  const { profile, refreshProfile } = useProfile();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const firstLogin = profile?.must_change_password;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const missing = missingRules(password);
    if (missing.length > 0) {
      setError(`Your password still needs: ${missing.map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join(', ')}.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords don\'t match.');
      return;
    }

    setSaving(true);
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) {
      setError(authError.message);
      setSaving(false);
      return;
    }

    await supabase.from('profiles').update({ must_change_password: false }).eq('id', profile.id);
    const updated = await refreshProfile();
    router.replace(homeFor(updated?.role));
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '56px 20px 48px' }}>
      {firstLogin && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <img src="/brand/odyssey-horizontal.svg" alt="ODYSSEY" className="logo-light" style={{ height: 32 }} />
          <img src="/brand/odyssey-horizontal-on-dark.svg" alt="ODYSSEY" className="logo-dark" style={{ height: 32 }} />
        </div>
      )}
      {!firstLogin && <BackLink href="/account">Back to My Account</BackLink>}
      <div className="card card-accent" style={{ padding: 32 }}>
        <h1 className="page-title" style={{ fontSize: 22, marginBottom: firstLogin ? 8 : 24 }}>{firstLogin ? 'Set your own password' : 'Change password'}</h1>
        {firstLogin && (
          <p className="text-2" style={{ marginBottom: 24 }}>
            Your account was set up or reset by ODCC&apos;s System Admin. Choose your own password to continue.
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>New password</label>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={PASSWORD_EXAMPLE} autoComplete="new-password" />
            <PasswordChecklist password={password} />
          </div>
          <div className="field" style={{ marginBottom: 24 }}>
            <label>Confirm new password</label>
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" autoComplete="new-password" />
            {confirm && <p className={`small ${confirm === password ? 'text-success' : 'text-danger'}`} style={{ margin: '6px 0 0' }}>{confirm === password ? '✓ The passwords match' : 'The passwords don\'t match yet'}</p>}
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

          <button type="submit" disabled={saving} className="btn btn-block">
            {saving ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Saving…</span> : 'Save password'}
          </button>
        </form>
      </div>
    </div>
  );
}
