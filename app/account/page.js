'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';
import { teamOf } from '../../lib/roles';

export default function MyAccount() {
  const { profile, refreshProfile } = useProfile();
  const [fullName, setFullName] = useState('');
  const [engagementName, setEngagementName] = useState('');
  const [message, setMessage] = useState('');
  const supabase = createClient();

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || '');
    if (profile.client_engagement_id) {
      supabase.from('engagements').select('client_name, engagement_name').eq('id', profile.client_engagement_id).single()
        .then(({ data }) => setEngagementName(data ? `${data.client_name} — ${data.engagement_name}` : ''));
    }
  }, [profile]);

  async function handleSave(e) {
    e.preventDefault();
    const { error } = await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', profile.id);
    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage('Saved.');
      refreshProfile();
    }
  }

  if (!profile) return null;

  const row = { display: 'flex', padding: '8px 0', borderBottom: '1px solid #eee' };
  const label = { width: 140, color: '#666' };

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <h1>My Account</h1>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <div style={row}><span style={label}>Email</span><span>{profile.email}</span></div>
        <div style={row}><span style={label}>Role</span><span>{profile.role}</span></div>
        <div style={row}><span style={label}>Team</span><span>{teamOf(profile.role)}</span></div>
        {engagementName && <div style={row}><span style={label}>Engagement</span><span>{engagementName}</span></div>}
        <p style={{ color: '#666', fontSize: 13, marginBottom: 0 }}>Your email and role can only be changed by Firm Leadership.</p>
      </div>

      <form onSubmit={handleSave} style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>Full name</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={fullName} onChange={(e) => { setFullName(e.target.value); setMessage(''); }} required style={{ flex: 1, padding: 8 }} />
          <button type="submit" style={{ padding: '8px 16px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Save</button>
        </div>
        {message && <p style={{ color: message.startsWith('Error') ? 'crimson' : '#2a7', marginBottom: 0 }}>{message}</p>}
      </form>

      <div style={{ background: 'white', padding: 20, borderRadius: 8 }}>
        <strong>Password</strong>
        <p style={{ color: '#666', margin: '4px 0 12px' }}>Change the password you use to sign in.</p>
        <Link href="/change-password">Change password &rarr;</Link>
      </div>
    </div>
  );
}
