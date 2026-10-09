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

  return (
    <div className="page page-narrow">
      <BackLink href={homeFor(profile.role)}>Back to {homeLabel(profile.role)}</BackLink>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Account</h1>
        </div>
      </div>

      <div className="stack">
        <div className="card" style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <Avatar profile={profile} size={72} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 className="card-title">Profile picture</h2>
            <p className="card-subtitle" style={{ marginBottom: 12 }}>PNG, JPG or WebP, up to 2 MB. It shows in the sidebar.</p>
            <div className="row" style={{ gap: 8 }}>
              <label className="btn btn-secondary btn-sm" style={{ marginBottom: 0, cursor: uploading ? 'wait' : 'pointer' }}>
                {uploading ? <><Spinner /> Uploading…</> : (profile.avatar_url ? 'Change picture' : 'Upload picture')}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePicture} disabled={uploading} style={{ display: 'none' }} />
              </label>
              {profile.avatar_url && !uploading && (
                <button type="button" onClick={removePicture} className="btn btn-ghost btn-sm">Remove</button>
              )}
            </div>
            {pictureMessage && <div className={`alert ${pictureMessage.startsWith('Error') ? 'alert-danger' : 'alert-success'}`} style={{ marginTop: 12 }}>{pictureMessage}</div>}
          </div>
        </div>

        <div className="card">
          <dl style={{ margin: '-10px 0 0' }}>
            <div style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}><dt className="text-2" style={{ width: 140, flexShrink: 0 }}>Email</dt><dd style={{ margin: 0 }}>{profile.email}</dd></div>
            <div style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}><dt className="text-2" style={{ width: 140, flexShrink: 0 }}>Role</dt><dd style={{ margin: 0 }}>{profile.role}</dd></div>
            <div style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}><dt className="text-2" style={{ width: 140, flexShrink: 0 }}>Team</dt><dd style={{ margin: 0 }}>{teamOf(profile.role)}</dd></div>
            {engagementName && <div style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}><dt className="text-2" style={{ width: 140, flexShrink: 0 }}>Engagement</dt><dd style={{ margin: 0 }}>{engagementName}</dd></div>}
          </dl>
          <p className="hint" style={{ marginTop: 16, marginBottom: 0 }}>Your email and role can only be changed by the System Administrator.</p>
        </div>

        <form onSubmit={handleSave} className="card">
          <label htmlFor="account-full-name">Full name</label>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
            <input id="account-full-name" value={fullName} onChange={(e) => { setFullName(e.target.value); setMessage(''); }} required style={{ flex: 1 }} />
            <button type="submit" className="btn">Save</button>
          </div>
          {message && <div className={`alert ${message.startsWith('Error') ? 'alert-danger' : 'alert-success'}`} style={{ marginTop: 12 }}>{message}</div>}
        </form>

        <div className="card row-between">
          <div>
            <h2 className="card-title">Password</h2>
            <p className="card-subtitle" style={{ margin: 0 }}>Change the password you use to sign in.</p>
          </div>
          <Link href="/change-password" className="btn btn-secondary">Change password &rarr;</Link>
        </div>
      </div>
    </div>
  );
}
