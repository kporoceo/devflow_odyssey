'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabaseClient';
import { useProfile, applyTheme } from '../../components/AppShell';

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
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <h1>Settings</h1>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <strong>Appearance</strong>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {THEMES.map((t) => (
            <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="radio" name="theme" checked={current === t.value} onChange={() => chooseTheme(t.value)} />
              {t.label}
            </label>
          ))}
        </div>
        {message && <p style={{ color: message.startsWith('Error') ? 'crimson' : '#2a7', marginBottom: 0 }}>{message}</p>}
      </div>

      <div style={{ background: 'white', padding: 20, borderRadius: 8 }}>
        <strong>Sessions</strong>
        <p style={{ color: '#666', margin: '4px 0 12px' }}>Sign out on every computer and phone where you&apos;re logged in.</p>
        <button onClick={signOutEverywhere} style={{ padding: '8px 16px', cursor: 'pointer' }}>Sign out everywhere</button>
      </div>
    </div>
  );
}
