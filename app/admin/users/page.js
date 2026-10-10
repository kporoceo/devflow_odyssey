'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';
import { useProfile } from '../../../components/AppShell';
import { ALL_ROLES, CLIENT_ROLE, teamOf } from '../../../lib/roles';
import { BusyLabel } from '../../../components/ui';

const EMPTY_FORM = { full_name: '', email: '', role: 'Audit Associate', client_engagement_id: '', send_email: true };

export default function ManageUsers() {
  const { profile } = useProfile();
  const [users, setUsers] = useState([]);
  const [engagements, setEngagements] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [edits, setEdits] = useState({}); // { [userId]: { role, client_engagement_id } }
  const [notice, setNotice] = useState(null); // { text, password? }
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  // The list comes from the server route, because the System Administrator
  // can't read engagements directly (they have no access to audit data).
  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'list' }),
    });
    const result = await res.json();
    if (!res.ok) {
      setError(result.error || 'Could not load the accounts.');
      return;
    }
    setUsers(result.users);
    setEngagements(result.engagements);
  }

  useEffect(() => { load(); }, []);

  // Calls the server route, sending this session's token so it can check we're the System Administrator.
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
      setCopied(false);
      setNotice(result.emailed
        ? { text: `Account created for ${form.full_name}. ODYSSEY emailed ${result.emailed} a link to set their own password.` }
        : { text: `Account created for ${form.full_name} (${form.email}). Give them this default password. They'll be asked to change it when they first log in.`, password: result.password });
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
    setCopied(false);
    if (result) setNotice({ text: `New default password for ${user.full_name || user.email}. They'll be asked to change it at their next login.`, password: result.password });
  }

  async function emailReset(user) {
    if (!confirm(`Email ${user.email} a link to set a new password?`)) return;
    const result = await callApi({ action: 'email_reset', user_id: user.id });
    if (result) setNotice({ text: `Reset link emailed to ${result.emailed}. They'll set a new password from the link.` });
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

  const fieldInput = { marginTop: 6 };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Manage Users</h1>
          <p className="page-subtitle">Only the System Administrator creates accounts. Each new account gets an email with a link to set their own password, or a default password that they must change at first login. The System Administrator can&apos;t open engagements, journal entries or reports.</p>
        </div>
      </div>

      <div className="stack-lg">
        <form onSubmit={handleCreate} className="card card-accent">
          <h2 className="card-title" style={{ marginBottom: 16 }}>Create account</h2>
          <div className="grid-2">
            <label style={{ marginBottom: 0 }}>Full name<input style={fieldInput} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
            <label style={{ marginBottom: 0 }}>Email<input style={fieldInput} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
            <label style={{ marginBottom: 0 }}>Role
              <select style={fieldInput} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ALL_ROLES.map((r) => <option key={r} value={r}>{r} ({teamOf(r)})</option>)}
              </select>
            </label>
            {form.role === CLIENT_ROLE && (
              <label style={{ marginBottom: 0 }}>Client&apos;s engagement
                <select style={fieldInput} value={form.client_engagement_id} onChange={(e) => setForm({ ...form, client_engagement_id: e.target.value })} required>
                  <option value="">Choose…</option>
                  {engagements.map((eng) => <option key={eng.id} value={eng.id}>{eng.client_name} — {eng.engagement_name}</option>)}
                </select>
              </label>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontWeight: 400 }}>
            <input type="checkbox" checked={form.send_email} onChange={(e) => setForm({ ...form, send_email: e.target.checked })} />
            Email them a link to set their own password
          </label>
          <p className="hint" style={{ margin: '4px 0 0 24px' }}>Untick to get a default password to give them yourself (for accounts without a real inbox).</p>
          <div className="form-actions" style={{ marginTop: 20 }}>
            <button type="submit" disabled={busy} className="btn">
              <BusyLabel busy={busy} busyText="Creating…">Create account</BusyLabel>
            </button>
          </div>
        </form>

        {(error || notice) && (
          <div className="stack">
            {error && <div className="alert alert-danger">{error}</div>}
            {notice && (
              <div className="alert alert-success">
                <p style={{ margin: 0 }}>{notice.text}</p>
                {notice.password && (
                  <p style={{ margin: '10px 0 0' }}>
                    Default password: <code style={{ fontSize: 17, fontWeight: 500, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', padding: '2px 8px', userSelect: 'all' }}>{notice.password}</code>
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(notice.password); setCopied(true); }} className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <br /><span className="small text-2">It is shown only once. Copy it now.</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const edit = edits[u.id];
                const isMe = u.id === profile?.id;
                return (
                  <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.6 }}>
                    <td>
                      <strong>{u.full_name || '(no name)'}</strong>{isMe && <span className="muted">{' (you)'}</span>}<br />
                      <span className="small muted">{u.email}</span>
                    </td>
                    <td>
                      {isMe ? <span className="badge badge-info">{u.role}</span> : (
                        <>
                          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                            <select
                              value={edit?.role ?? u.role}
                              onChange={(e) => setEdits({ ...edits, [u.id]: { role: e.target.value, client_engagement_id: edit?.client_engagement_id ?? u.client_engagement_id ?? '' } })}
                              style={{ width: 'auto', minWidth: 180, minHeight: 32, padding: '5px 10px', fontSize: 13 }}
                            >
                              {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            {edit && <button onClick={() => saveRole(u)} disabled={busy} className="btn btn-sm">Save</button>}
                          </div>
                          {(edit?.role ?? u.role) === CLIENT_ROLE && (
                            edit ? (
                              <select
                                value={edit.client_engagement_id || ''}
                                onChange={(e) => setEdits({ ...edits, [u.id]: { ...edit, client_engagement_id: e.target.value } })}
                                style={{ width: 'auto', minWidth: 180, minHeight: 32, padding: '5px 10px', fontSize: 13, display: 'block', marginTop: 6 }}
                              >
                                <option value="">Choose engagement…</option>
                                {engagements.map((eng) => <option key={eng.id} value={eng.id}>{eng.client_name} — {eng.engagement_name}</option>)}
                              </select>
                            ) : <div className="small muted" style={{ marginTop: 6 }}>{engagementLabel(u.client_engagement_id) || 'No engagement'}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className={u.is_active ? 'badge badge-success' : 'badge'}>{u.is_active ? 'Active' : 'Deactivated'}</span>
                        {u.is_active && u.must_change_password && <span className="badge badge-warning">Still on default password</span>}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!isMe && (
                        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <button onClick={() => emailReset(u)} disabled={busy} className="btn btn-secondary btn-sm">Email reset link</button>
                          <button onClick={() => resetPassword(u)} disabled={busy} className="btn btn-secondary btn-sm">Reset password</button>
                          <button onClick={() => toggleActive(u)} disabled={busy} className={u.is_active ? 'btn btn-danger-outline btn-sm' : 'btn btn-secondary btn-sm'}>{u.is_active ? 'Deactivate' : 'Reactivate'}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
