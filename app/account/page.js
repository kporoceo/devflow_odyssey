'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { useProfile, Avatar } from '../../components/AppShell';
import { teamOf, homeFor, homeLabel } from '../../lib/roles';
import { BackLink, Spinner } from '../../components/ui';

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;

export default function MyAccount() {
  const { profile, refreshProfile } = useProfile();
  const [fullName, setFullName] = useState('');
  const [engagementName, setEngagementName] = useState('');
  const [message, setMessage] = useState('');
  const [pictureMessage, setPictureMessage] = useState('');
  const [uploading, setUploading] = useState(false);
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

  // Uploads to the "avatars" bucket, in a folder named after this person's
  // id (the storage rules only allow your own folder), then saves the link.
  async function handlePicture(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPictureMessage('');
    if (!PICTURE_TYPES.includes(file.type)) {
      setPictureMessage('Error: use a PNG, JPG or WebP picture.');
      return;
    }
    if (file.size > MAX_PICTURE_BYTES) {
      setPictureMessage('Error: the picture must be 2 MB or smaller.');
      return;
    }
    setUploading(true);
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const path = `${profile.id}/avatar-${Date.now()}.${ext}`;
    const { error: upError } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type });
    if (upError) {
      setPictureMessage(`Error: ${upError.message}`);
      setUploading(false);
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    const { error } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', profile.id);
    // Remove the previous picture so old ones don't pile up.
    const old = profile.avatar_url && profile.avatar_url.split('/avatars/')[1];
    if (!error && old) await supabase.storage.from('avatars').remove([old]);
    setUploading(false);
    setPictureMessage(error ? `Error: ${error.message}` : 'Picture saved.');
    if (!error) refreshProfile();
  }

  async function removePicture() {
    setPictureMessage('');
    const old = profile.avatar_url && profile.avatar_url.split('/avatars/')[1];
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profile.id);
    if (!error && old) await supabase.storage.from('avatars').remove([old]);
    setPictureMessage(error ? `Error: ${error.message}` : 'Picture removed.');
    if (!error) refreshProfile();
  }

  if (!profile) return null;

  const row = { display: 'flex', padding: '8px 0', borderBottom: '1px solid #eee' };
  const label = { width: 140, color: '#666' };

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <BackLink href={homeFor(profile.role)}>Back to {homeLabel(profile.role)}</BackLink>
      <h1>My Account</h1>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Avatar profile={profile} size={72} />
        <div>
          <strong>Profile picture</strong>
          <p style={{ color: '#666', margin: '4px 0 8px', fontSize: 14 }}>PNG, JPG or WebP, up to 2 MB. It shows in the sidebar.</p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, cursor: uploading ? 'wait' : 'pointer' }}>
            {uploading ? <><Spinner /> Uploading…</> : (profile.avatar_url ? 'Change picture' : 'Upload picture')}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePicture} disabled={uploading} style={{ display: 'none' }} />
          </label>
          {profile.avatar_url && !uploading && (
            <button type="button" onClick={removePicture} style={{ marginLeft: 8, padding: '6px 12px', cursor: 'pointer' }}>Remove</button>
          )}
          {pictureMessage && <p style={{ color: pictureMessage.startsWith('Error') ? 'crimson' : '#2a7', margin: '8px 0 0' }}>{pictureMessage}</p>}
        </div>
      </div>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <div style={row}><span style={label}>Email</span><span>{profile.email}</span></div>
        <div style={row}><span style={label}>Role</span><span>{profile.role}</span></div>
        <div style={row}><span style={label}>Team</span><span>{teamOf(profile.role)}</span></div>
        {engagementName && <div style={row}><span style={label}>Engagement</span><span>{engagementName}</span></div>}
        <p style={{ color: '#666', fontSize: 13, marginBottom: 0 }}>Your email and role can only be changed by the System Administrator.</p>
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
