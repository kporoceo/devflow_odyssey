'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';
import { canPrepareReports, isClient, SIGNOFF_LEVELS } from '../../lib/roles';
import { BackLink, Spinner } from '../../components/ui';

// Report status colours, from app/globals.css.
const STATUS_BADGE = {
  'Draft': 'badge',
  'Returned': 'badge badge-danger',
  'For Review': 'badge badge-warning',
  'For Partner Approval': 'badge badge-warning',
  'For Client Approval': 'badge badge-warning',
  'Signed Off': 'badge badge-success',
};

// Firm staff: every report, plus a form to start one.
// Client: only its own engagement's reports that reached the client level.
export default function Reports() {
  const { profile } = useProfile();
  const [reports, setReports] = useState([]);
  const [engagements, setEngagements] = useState([]);
  const [engagementId, setEngagementId] = useState('');
  const [title, setTitle] = useState('');
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [fromEngagement, setFromEngagement] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    if (!profile) return;
    async function load() {
      // Links can narrow the list: /reports?engagement=<id> or /reports?waiting=1
      const params = new URLSearchParams(window.location.search);
      const engagementFilter = params.get('engagement');
      if (engagementFilter) {
        setEngagementId(engagementFilter);
        setFromEngagement(engagementFilter);
      }
      if (params.get('waiting') === '1') setOnlyWaiting(true);

      let query = supabase
        .from('reports')
        .select('id, title, status, updated_at, engagement_id, engagements(client_name, engagement_name)')
        .order('updated_at', { ascending: false });
      if (engagementFilter) query = query.eq('engagement_id', engagementFilter);
      const { data } = await query;
      setReports(data || []);

      if (canPrepareReports(profile.role)) {
        const { data: engRows } = await supabase.from('engagements').select('id, client_name, engagement_name').order('client_name');
        setEngagements(engRows || []);
      }
      setLoading(false);
    }
    load();
  }, [profile]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    const { data, error } = await supabase
      .from('reports')
      .insert({ engagement_id: engagementId, title: title.trim() })
      .select()
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/reports/${data.id}`);
  }

  if (!profile || loading) return <p className="loading"><Spinner /> Loading…</p>;

  const myStatuses = SIGNOFF_LEVELS.filter((s) => s.canAct(profile.role)).map((s) => s.status);
  const shown = onlyWaiting ? reports.filter((r) => myStatuses.includes(r.status)) : reports;

  return (
    <div className="page">
      {!isClient(profile.role) && (fromEngagement
        ? <BackLink href={`/engagements/${fromEngagement}`}>Back to Engagement</BackLink>
        : <BackLink href="/dashboard">Back to Dashboard</BackLink>)}
      <div className="page-header">
        <div>
          <h1 className="page-title">{isClient(profile.role) ? 'My Reports' : 'Reports'}</h1>
          {isClient(profile.role) && (
            <p className="page-subtitle">Reports from your auditors appear here once they are ready for your review and sign-off.</p>
          )}
        </div>
      </div>

      <div className="split">
        {canPrepareReports(profile.role) && (
          <form onSubmit={handleCreate} className="card">
            <h2 className="card-title" style={{ marginBottom: 20 }}>Start a report</h2>

            <div className="field">
              <label>Engagement</label>
              <select value={engagementId} onChange={(e) => setEngagementId(e.target.value)} required>
                <option value="">Choose engagement…</option>
                {engagements.map((eng) => <option key={eng.id} value={eng.id}>{eng.client_name} — {eng.engagement_name}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Report title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. JE Testing Findings FY2026" required/>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn">Create draft</button>
            </div>

            {error && <div className="alert alert-danger" style={{ marginTop: 16 }}>{error}</div>}
          </form>
        )}

        <div className="stack">
          {!isClient(profile.role) && (
              <label className="text-2" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={onlyWaiting} onChange={(e) => setOnlyWaiting(e.target.checked)} />
                Only show reports waiting for me
              </label>
            )}

            {shown.length === 0 ? (
              <p className="muted">No reports yet.</p>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                {shown.map((r) => (
                  <Link key={r.id} href={`/reports/${r.id}`} className="link-card">
                    <div className="row-between">
                      <div>
                        <p className="link-card-title">{r.title}</p>
                        <p className="link-card-text">
                          {r.engagements?.client_name} — {r.engagements?.engagement_name}
                        </p>
                      </div>
                      <span className={STATUS_BADGE[r.status] || 'badge'}>
                        {r.status}{myStatuses.includes(r.status) ? ' · your turn' : ''}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
