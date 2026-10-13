'use client';

// Account Activity (Part M, finals panel): everything the System
// Administrator did to user accounts, newest first. Firm Leadership can read
// it; nobody can edit it. If the administrator's account is ever compromised,
// the Managing Partner deactivates it here (break-glass).

import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';
import { BusyLabel, Spinner } from '../../components/ui';

const PRIVILEGED_WORDS = /Partner|System Administrator/;

function when(ts) {
  return new Date(ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AccountActivity() {
  const { profile } = useProfile();
  const [rows, setRows] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const supabase = createClient();
  const isMP = profile?.role === 'Managing Partner';

  async function callApi(payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
  }

  async function load() {
    const { data } = await supabase.from('admin_activity').select('*').order('at', { ascending: false }).limit(200);
    setRows(data || []);
    if (isMP) {
      try { setAdmins((await callApi({ action: 'list_admins' })).admins); } catch (e) { setMessage(e.message); }
    }
    setLoading(false);
  }

  useEffect(() => { if (profile) load(); }, [profile]);

  async function toggle(a) {
    const verb = a.is_active ? 'Deactivate' : 'Reactivate';
    if (!confirm(`${verb} the System Administrator account of ${a.full_name || a.email}?`)) return;
    setBusyId(a.id);
    setMessage('');
    try {
      await callApi({ action: 'set_active', user_id: a.id, is_active: !a.is_active });
      setMessage(`${a.full_name || a.email} was ${a.is_active ? 'deactivated. They are signed out within the hour and can\'t log in again' : 'reactivated'}.`);
      await load();
    } catch (e) {
      setMessage(e.message);
    }
    setBusyId('');
  }

  if (loading) return <p className="loading"><Spinner /> Loading account activity…</p>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Account Activity</h1>
          <p className="page-subtitle">Every change the System Administrator made to user accounts, newest first. It is written by the server and can&apos;t be edited or deleted. Lines that give or touch a signing or admin role are highlighted.</p>
        </div>
      </div>

      <div className="stack-lg">
        {isMP && (
          <div className="card card-accent">
            <h2 className="card-title">System Administrator accounts</h2>
            <p className="card-subtitle">If an administrator&apos;s account may be compromised, deactivate it here first, then follow the steps in the paper (Data Security, Compromised Administrator Account).</p>
            {message && <p className="alert alert-info" style={{ margin: '12px 0' }}>{message}</p>}
            {admins.map((a) => (
              <div key={a.id} className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <span>{a.full_name || a.email} <span className="muted small">{a.email}</span> {!a.is_active && <span className="badge badge-danger">Deactivated</span>}</span>
                <button type="button" onClick={() => toggle(a)} disabled={!!busyId} className={a.is_active ? 'btn btn-danger-outline btn-sm' : 'btn btn-secondary btn-sm'}>
                  <BusyLabel busy={busyId === a.id} busyText="Saving…">{a.is_active ? 'Deactivate' : 'Reactivate'}</BusyLabel>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr><th>When</th><th>Who</th><th>Did what</th><th>To whom</th><th>Details</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="muted">No account changes recorded yet.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} style={PRIVILEGED_WORDS.test(`${r.details} ${r.action}`) ? { background: 'var(--warning-soft)' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                    <td>{r.actor_name}<div className="muted small">{r.actor_role}</div></td>
                    <td>{r.action}</td>
                    <td>{r.target_name || '—'}<div className="muted small">{r.target_email}</div></td>
                    <td>{r.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
