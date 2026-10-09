'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabaseClient';
import { useProfile } from '../../../components/AppShell';
import { isAuditTeam, isLeadership } from '../../../lib/roles';
import { BackLink, BusyLabel, Spinner } from '../../../components/ui';

export default function EngagementDetail({ params }) {
  const { id } = params;
  const { profile } = useProfile();
  const [engagement, setEngagement] = useState(null);
  const [entryCount, setEntryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: eng, error } = await supabase
        .from('engagements')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !eng) {
        router.push('/engagements');
        return;
      }
      setEngagement(eng);

      // count() is a lightweight way to get row totals without fetching all rows
      const { count } = await supabase
        .from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('engagement_id', id);

      setEntryCount(count || 0);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading || !profile) return <p className="loading"><Spinner /> Loading…</p>;

  const leadership = isLeadership(profile.role);
  const inactive = engagement.status === 'Inactive';

  // Firm Leadership only; the database checks this again (set_engagement_status).
  async function setStatus(status) {
    const verb = status === 'Inactive' ? 'Mark this engagement Inactive? No one can upload entries or run tests until it is reactivated.' : 'Reactivate this engagement?';
    if (!confirm(verb)) return;
    setBusy('status');
    setMessage('');
    const { error } = await supabase.rpc('set_engagement_status', { p_id: id, p_status: status });
    setBusy('');
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setEngagement({ ...engagement, status });
    setMessage(status === 'Inactive' ? 'Marked Inactive.' : 'Reactivated.');
  }

  // Only works on an engagement with no entries, test runs or reports (delete_engagement).
  async function handleDelete() {
    if (!confirm(`Delete "${engagement.engagement_name}" for ${engagement.client_name}? This can't be undone.`)) return;
    setBusy('delete');
    setMessage('');
    const { error } = await supabase.rpc('delete_engagement', { p_id: id });
    setBusy('');
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    router.push('/engagements');
  }

  // Each card is shown only to the roles allowed to use it (the database
  // enforces the same rules).
  const auditTeam = isAuditTeam(profile.role);
  const cards = [
    auditTeam && !inactive && { href: `/engagements/${id}/upload`, title: 'Upload JE Data', text: entryCount > 0 ? `${entryCount} entries uploaded` : 'No entries yet' },
    auditTeam && { href: `/engagements/${id}/criteria`, title: 'Configure Testing Criteria', text: 'Set the parameters for the 7 JE testing rules' },
    auditTeam && !inactive && { href: `/engagements/${id}/testing`, title: 'Run JE Testing', text: 'Run the 7 rules against every uploaded entry' },
    (auditTeam || isLeadership(profile.role)) && { href: `/engagements/${id}/history`, title: 'Testing History & Audit Trail', text: 'Review past runs, who ran them, and what was flagged' },
    (auditTeam || isLeadership(profile.role)) && { href: `/engagements/${id}/analytics`, title: 'Analytics', text: 'Dashboard of the entries: trends, weekends, posting lag, duplicates and more' },
    { href: `/reports?engagement=${id}`, title: 'Reports & Sign-off', text: 'Prepare reports and follow their sign-off' },
  ].filter(Boolean);

  return (
    <div className="page">
      <BackLink href="/engagements">Back to Engagements</BackLink>

      <div className="page-header">
        <div>
          <h1 className="page-title">{engagement.engagement_name}</h1>
          <p className="page-subtitle">{engagement.client_name}</p>
          <p style={{ margin: '12px 0 0' }}>
            <span className={inactive ? 'badge' : 'badge badge-success'}>{engagement.status}</span>
          </p>
          {inactive && <p className="muted" style={{ margin: '8px 0 0' }}>This engagement is read-only: no new uploads or test runs.</p>}
        </div>
        {leadership && (
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => setStatus(inactive ? 'Active' : 'Inactive')} disabled={!!busy} className="btn btn-secondary btn-sm">
              <BusyLabel busy={busy === 'status'} busyText="Saving…">{inactive ? 'Reactivate' : 'Mark Inactive'}</BusyLabel>
            </button>
            {entryCount === 0 && (
              <button onClick={handleDelete} disabled={!!busy} className="btn btn-danger-outline btn-sm">
                <BusyLabel busy={busy === 'delete'} busyText="Deleting…">Delete engagement</BusyLabel>
              </button>
            )}
          </div>
        )}
      </div>

      {(leadership && entryCount > 0) || message ? (
        <div className="stack" style={{ gap: 12, marginBottom: 24 }}>
          {leadership && entryCount > 0 && (
            <p className="hint" style={{ margin: 0 }}>Engagements with uploaded entries are kept as audit evidence, so they can be made Inactive but not deleted.</p>
          )}
          {message && <div className={message.startsWith('Error') ? 'alert alert-danger' : 'alert alert-success'}>{message}</div>}
        </div>
      ) : null}

      <div className="grid-2">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="link-card">
            <h3 className="link-card-title">{c.title}</h3>
            <p className="link-card-text">{c.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
