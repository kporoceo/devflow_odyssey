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
  const [progress, setProgress] = useState({ criteria: null, runs: [], reports: [] });
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

      // What has been done so far, for the step badges below.
      const [{ data: criteria }, { data: runs }, { data: reports }] = await Promise.all([
        supabase.from('testing_criteria').select('updated_at').eq('engagement_id', id).maybeSingle(),
        supabase.from('je_test_results').select('run_at, flagged_count, total_entries').eq('engagement_id', id).order('run_at', { ascending: false }),
        supabase.from('reports').select('status, updated_at').eq('engagement_id', id).order('updated_at', { ascending: false }),
      ]);
      setProgress({ criteria, runs: runs || [], reports: reports || [] });
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

  // The 6 steps in the order the work is done. Each one shows how far it has
  // got. A step the person's role can't use is shown greyed out, so everyone
  // still sees the whole picture (the database enforces the same rules).
  const auditTeam = isAuditTeam(profile.role);
  const canSeeTesting = auditTeam || leadership;
  const { criteria, runs, reports } = progress;
  const lastRun = runs[0];
  const lastReport = reports[0];
  const day = (d) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  const notAllowed = (who) => (inactive && who === 'audit-active' ? 'The engagement is Inactive' : 'For the Audit Team');

  const steps = [
    {
      href: `/engagements/${id}/criteria`, title: 'Configure Testing Criteria',
      allowed: auditTeam, who: 'audit',
      done: !!criteria,
      badge: criteria ? ['Configured', 'badge-success'] : ['Using defaults', 'badge-warning'],
      text: criteria ? `Saved ${day(criteria.updated_at)}` : 'Set the parameters for the 7 JE testing rules',
    },
    {
      href: `/engagements/${id}/upload`, title: 'Upload JE Data',
      allowed: auditTeam && !inactive, who: 'audit-active',
      done: entryCount > 0,
      badge: entryCount > 0 ? ['Uploaded', 'badge-success'] : ['Not yet', 'badge'],
      text: entryCount > 0 ? `${entryCount.toLocaleString()} lines uploaded` : 'Upload the client\'s general ledger',
    },
    {
      href: `/engagements/${id}/testing`, title: 'Run JE Testing',
      allowed: auditTeam && !inactive, who: 'audit-active',
      done: runs.length > 0,
      badge: runs.length > 0 ? ['Tested', 'badge-success'] : entryCount > 0 ? ['Ready to run', 'badge-info'] : ['Waiting for upload', 'badge'],
      text: lastRun ? `Last run ${day(lastRun.run_at)}: ${lastRun.flagged_count} of ${lastRun.total_entries} lines flagged` : 'Run the 7 rules against every uploaded entry',
    },
    {
      href: `/engagements/${id}/history`, title: 'Testing History & Audit Trail',
      allowed: canSeeTesting, who: 'audit',
      done: runs.length > 0,
      badge: runs.length > 0 ? [`${runs.length} run${runs.length === 1 ? '' : 's'}`, 'badge-success'] : ['No runs yet', 'badge'],
      text: 'Review past runs, who ran them, and what was flagged',
    },
    {
      href: `/reports?engagement=${id}`, title: 'Reports & Sign-off',
      allowed: true,
      done: lastReport?.status === 'Signed Off',
      badge: lastReport ? [lastReport.status, lastReport.status === 'Signed Off' ? 'badge-success' : lastReport.status === 'Returned' ? 'badge-danger' : lastReport.status === 'Draft' ? 'badge' : 'badge-warning'] : ['No report yet', 'badge'],
      text: reports.length > 1 ? `${reports.length} reports; showing the latest` : 'Prepare reports and follow their sign-off',
    },
    {
      href: `/engagements/${id}/analytics`, title: 'Analytics',
      allowed: canSeeTesting, who: 'audit',
      done: false,
      badge: entryCount > 0 ? ['Live', 'badge-gold'] : ['Waiting for upload', 'badge'],
      text: 'Dashboard of the entries: trends, weekends, posting lag and more',
    },
  ];
  // The first step not done yet (and usable by this person) is the next one.
  const nextIndex = steps.findIndex((s) => s.allowed && !s.done && s.title !== 'Analytics' && s.title !== 'Testing History & Audit Trail');

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

      <div className="grid-3">
        {steps.map((st, i) => {
          const inner = (
            <>
              <div className="row-between" style={{ alignItems: 'center', marginBottom: 10 }}>
                <span className={`step-number${st.done ? ' step-done' : ''}`}>{st.done ? '✓' : i + 1}</span>
                <span className={`badge ${st.badge[1]}`}>{st.badge[0]}</span>
              </div>
              <h3 className="link-card-title">{st.title}</h3>
              <p className="link-card-text">{st.allowed ? st.text : notAllowed(st.who)}</p>
              {i === nextIndex && <p className="step-next">Next step</p>}
            </>
          );
          return st.allowed
            ? <Link key={st.href} href={st.href} className={`link-card${i === nextIndex ? ' step-current' : ''}`}>{inner}</Link>
            : <div key={st.href} className="link-card step-locked" aria-disabled="true">{inner}</div>;
        })}
      </div>
    </div>
  );
}
