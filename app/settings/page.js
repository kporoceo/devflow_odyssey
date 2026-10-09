'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabaseClient';
import { useProfile, applyTheme } from '../../components/AppShell';
import { homeFor, homeLabel } from '../../lib/roles';
import { BackLink } from '../../components/ui';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Same as my device' },
];

export default function Settings() {
  const { profile, refreshProfile } = useProfile();
  const [message, setMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  // The choice is saved to the profile, so it follows the person to any device.
  async function chooseTheme(theme) {
    applyTheme(theme);
    const { error } = await supabase.from('profiles').update({ theme }).eq('id', profile.id);
    setMessage(error ? `Error: ${error.message}` : 'Appearance saved.');
    if (!error) refreshProfile();
  }

  async function signOutEverywhere() {
    await supabase.auth.signOut({ scope: 'global' });
    router.replace('/login');
  }

  if (!profile) return null;
  const current = profile.theme || 'system';

  return (
    <div className="page page-narrow">
      <BackLink href={homeFor(profile.role)}>Back to {homeLabel(profile.role)}</BackLink>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <h2 className="card-title" style={{ marginBottom: 16 }}>Appearance</h2>
          <div className="grid-3" style={{ gap: 12 }}>
            {THEMES.map((t) => {
              const selected = current === t.value;
              return (
                <label
                  key={t.value}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0,
                    padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
                    background: selected ? 'var(--accent-soft)' : 'var(--surface)',
                    color: 'var(--text)', fontSize: 14, fontWeight: selected ? 600 : 500,
                    boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : 'none',
                  }}
                >
                  <input type="radio" name="theme" checked={current === t.value} onChange={() => chooseTheme(t.value)} />
                  {t.label}
                </label>
              );
            })}
          </div>
          {message && <div className={`alert ${message.startsWith('Error') ? 'alert-danger' : 'alert-success'}`} style={{ marginTop: 16 }}>{message}</div>}
        </div>

        <div className="card row-between">
          <div>
            <h2 className="card-title">Sessions</h2>
            <p className="card-subtitle" style={{ margin: 0 }}>Sign out on every computer and phone where you&apos;re logged in.</p>
          </div>
          <button onClick={signOutEverywhere} className="btn btn-danger-outline">Sign out everywhere</button>
        </div>
      </div>
    </div>
  );
}
