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
      setError(`Your password still needs: ${missing.join(', ').toLowerCase()}.`);
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
    <div style={{ maxWidth: 420, margin: '60px auto', padding: 24, background: 'white', borderRadius: 8 }}>
      {!firstLogin && <BackLink href="/account">Back to My Account</BackLink>}
      <h1 style={{ marginTop: 0 }}>{firstLogin ? 'Set your own password' : 'Change password'}</h1>
      {firstLogin && (
        <p style={{ color: '#666' }}>
          You logged in with the default password from Firm Leadership. Choose your own password to continue.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>New password</label>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={PASSWORD_EXAMPLE} autoComplete="new-password" />
          <PasswordChecklist password={password} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Confirm new password</label>
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" autoComplete="new-password" />
          {confirm && <p style={{ fontSize: 13, margin: '4px 0 0', color: confirm === password ? '#1e8449' : 'crimson' }}>{confirm === password ? '✓ The passwords match' : 'The passwords don\'t match yet'}</p>}
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <button type="submit" disabled={saving} style={{ width: '100%', padding: 10, background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          {saving ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Saving…</span> : 'Save password'}
        </button>
      </form>
    </div>
  );
}
