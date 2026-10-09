'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';
import { useProfile } from '../../../components/AppShell';
import { ALL_ROLES, CLIENT_ROLE, teamOf } from '../../../lib/roles';
import { BackLink, BusyLabel } from '../../../components/ui';

const EMPTY_FORM = { full_name: '', email: '', role: 'Audit Associate', client_engagement_id: '' };

export default function ManageUsers() {
  const { profile } = useProfile();
  const [users, setUsers] = useState([]);
  const [engagements, setEngagements] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [edits, setEdits] = useState({}); // { [userId]: { role, client_engagement_id } }
  const [notice, setNotice] = useState(null); // { text, password? }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  async function load() {
    const { data: userRows } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active, must_change_password, client_engagement_id, created_at')
      .order('created_at', { ascending: true });
    const { data: engRows } = await supabase
      .from('engagements')
      .select('id, client_name, engagement_name')
      .order('client_name');
    setUsers(userRows || []);
    setEngagements(engRows || []);
  }

  useEffect(() => { load(); }, []);

  // Calls the server route, sending this session's token so it can check we're Firm Leadership.
  async function callApi(payload) {
    setBusy(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(result.error || 'Something went wrong.');
      return null;
    }
    await load();
    return result;
  }

  async function handleCreate(e) {
    e.preventDefault();
    setNotice(null);
    const result = await callApi({ action: 'create', ...form });
    if (result) {
      setNotice({ text: `Account created for ${form.full_name} (${form.email}). Give them this default password. They'll be asked to change it when they first log in.`, password: result.password });
      setForm(EMPTY_FORM);
    }
  }

  async function saveRole(user) {
    const edit = edits[user.id];
    const result = await callApi({ action: 'update', user_id: user.id, ...edit });
    if (result) {
      setNotice({ text: `${user.full_name || user.email} is now ${edit.role}.` });
      setEdits((prev) => { const next = { ...prev }; delete next[user.id]; return next; });
    }
  }

  async function resetPassword(user) {
    if (!confirm(`Give ${user.full_name || user.email} a new default password?`)) return;
    const result = await callApi({ action: 'reset_password', user_id: user.id });
    if (result) setNotice({ text: `New default password for ${user.full_name || user.email}. They'll be asked to change it at their next login.`, password: result.password });
  }

  async function toggleActive(user) {
    const verb = user.is_active ? 'Deactivate' : 'Reactivate';
    if (!confirm(`${verb} ${user.full_name || user.email}?`)) return;
    const result = await callApi({ action: 'set_active', user_id: user.id, is_active: !user.is_active });
    if (result) setNotice({ text: `${user.full_name || user.email} was ${user.is_active ? 'deactivated' : 'reactivated'}.` });
  }

  const engagementLabel = (id) => {
    const eng = engagements.find((x) => x.id === id);
    return eng ? `${eng.client_name} — ${eng.engagement_name}` : '';
  };

  const input = { padding: 8, boxSizing: 'border-box', width: '100%' };

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', padding: 24 }}>
      <BackLink href="/dashboard">Back to Dashboard</BackLink>
      <h1>Manage Users</h1>
      <p style={{ color: '#666' }}>Only Firm Leadership can create accounts. Each new account gets a default password, which the person must change at first login.</p>

      <form onSubmit={handleCreate} style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create account</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>Full name<input style={input} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
          <label>Email<input style={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
          <label>Role
            <select style={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ALL_ROLES.map((r) => <option key={r} value={r}>{r} ({teamOf(r)})</option>)}
            </select>
          </label>
          {form.role === CLIENT_ROLE && (
            <label>Client&apos;s engagement
              <select style={input} value={form.client_engagement_id} onChange={(e) => setForm({ ...form, client_engagement_id: e.target.value })} required>
                <option value="">Choose…</option>
                {engagements.map((eng) => <option key={eng.id} value={eng.id}>{eng.client_name} — {eng.engagement_name}</option>)}
              </select>
            </label>
          )}
        </div>
        <button type="submit" disabled={busy} style={{ marginTop: 16, padding: '10px 20px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          <BusyLabel busy={busy} busyText="Creating…">Create account</BusyLabel>
        </button>
      </form>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {notice && (
        <div style={{ background: '#eaf6ea', border: '1px solid #8c8', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <p style={{ margin: 0 }}>{notice.text}</p>
          {notice.password && (
            <p style={{ margin: '8px 0 0' }}>
              Default password: <code style={{ fontSize: 18, background: 'white', padding: '2px 8px' }}>{notice.password}</code>
              <br /><span style={{ fontSize: 13, color: '#666' }}>It is shown only once. Copy it now.</span>
            </p>
          )}
        </div>
      )}

      <div style={{ background: 'white', borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
              <th style={{ padding: 10 }}>Name</th>
              <th style={{ padding: 10 }}>Role</th>
              <th style={{ padding: 10 }}>Status</th>
              <th style={{ padding: 10 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const edit = edits[u.id];
              const isMe = u.id === profile?.id;
              return (
                <tr key={u.id} style={{ borderBottom: '1px solid #eee', opacity: u.is_active ? 1 : 0.55 }}>
                  <td style={{ padding: 10 }}>
                    <strong>{u.full_name || '(no name)'}</strong>{isMe && ' (you)'}<br />
                    <span style={{ color: '#666' }}>{u.email}</span>
                  </td>
                  <td style={{ padding: 10 }}>
                    {isMe ? u.role : (
                      <>
                        <select
                          value={edit?.role ?? u.role}
                          onChange={(e) => setEdits({ ...edits, [u.id]: { role: e.target.value, client_engagement_id: edit?.client_engagement_id ?? u.client_engagement_id ?? '' } })}
                          style={{ padding: 6 }}
                        >
                          {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {(edit?.role ?? u.role) === CLIENT_ROLE && (
                          edit ? (
                            <select
                              value={edit.client_engagement_id || ''}
                              onChange={(e) => setEdits({ ...edits, [u.id]: { ...edit, client_engagement_id: e.target.value } })}
                              style={{ padding: 6, display: 'block', marginTop: 4 }}
                            >
                              <option value="">Choose engagement…</option>
                              {engagements.map((eng) => <option key={eng.id} value={eng.id}>{eng.client_name} — {eng.engagement_name}</option>)}
                            </select>
                          ) : <div style={{ color: '#666', marginTop: 4 }}>{engagementLabel(u.client_engagement_id) || 'No engagement'}</div>
                        )}
                        {edit && <button onClick={() => saveRole(u)} disabled={busy} style={{ marginLeft: 6, padding: '6px 10px', cursor: 'pointer' }}>Save</button>}
                      </>
                    )}
                  </td>
                  <td style={{ padding: 10 }}>
                    {u.is_active ? 'Active' : 'Deactivated'}
                    {u.is_active && u.must_change_password && <div style={{ color: '#a70', fontSize: 13 }}>Still on default password</div>}
                  </td>
                  <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
                    {!isMe && (
                      <>
                        <button onClick={() => resetPassword(u)} disabled={busy} style={{ padding: '6px 10px', cursor: 'pointer', marginRight: 6 }}>Reset password</button>
                        <button onClick={() => toggleActive(u)} disabled={busy} style={{ padding: '6px 10px', cursor: 'pointer' }}>{u.is_active ? 'Deactivate' : 'Reactivate'}</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
