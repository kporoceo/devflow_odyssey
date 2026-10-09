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

  if (loading || !profile) return <p style={{ padding: 24, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading…</p>;

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
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 24 }}>
      <BackLink href="/engagements">Back to Engagements</BackLink>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <h1 style={{ marginBottom: 4 }}>{engagement.engagement_name}</h1>
        <p style={{ color: '#666', marginTop: 0 }}>{engagement.client_name}</p>
        <p style={{ display: 'inline-block', padding: '4px 10px', background: inactive ? '#eee' : '#e8f5ee', color: inactive ? '#666' : '#2a7', borderRadius: 4, fontSize: 14 }}>
          {engagement.status}
        </p>
        {inactive && <p style={{ color: '#666', margin: '4px 0 0' }}>This engagement is read-only: no new uploads or test runs.</p>}
        {leadership && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setStatus(inactive ? 'Active' : 'Inactive')} disabled={!!busy} style={{ padding: '6px 12px', cursor: 'pointer' }}>
              <BusyLabel busy={busy === 'status'} busyText="Saving…">{inactive ? 'Reactivate' : 'Mark Inactive'}</BusyLabel>
            </button>
            {entryCount === 0 && (
              <button onClick={handleDelete} disabled={!!busy} style={{ padding: '6px 12px', cursor: 'pointer', color: 'crimson', border: '1px solid crimson', background: 'white', borderRadius: 4 }}>
                <BusyLabel busy={busy === 'delete'} busyText="Deleting…">Delete engagement</BusyLabel>
              </button>
            )}
          </div>
        )}
        {leadership && entryCount > 0 && (
          <p style={{ color: '#666', fontSize: 13, margin: '8px 0 0' }}>Engagements with uploaded entries are kept as audit evidence, so they can be made Inactive but not deleted.</p>
        )}
        {message && <p style={{ color: message.startsWith('Error') ? 'crimson' : '#2a7', margin: '8px 0 0' }}>{message}</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href}>
            <div style={{ background: 'white', padding: 20, borderRadius: 8, cursor: 'pointer', height: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ marginTop: 0 }}>{c.title}</h3>
              <p style={{ color: '#666', margin: 0 }}>{c.text}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
