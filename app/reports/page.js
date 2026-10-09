'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';
import { canPrepareReports, isClient, SIGNOFF_LEVELS, STATUS_COLORS } from '../../lib/roles';

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
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    if (!profile) return;
    async function load() {
      // Links can narrow the list: /reports?engagement=<id> or /reports?waiting=1
      const params = new URLSearchParams(window.location.search);
      const engagementFilter = params.get('engagement');
      if (engagementFilter) setEngagementId(engagementFilter);
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

  if (!profile || loading) return <p style={{ padding: 24 }}>Loading...</p>;

  const myStatuses = SIGNOFF_LEVELS.filter((s) => s.canAct(profile.role)).map((s) => s.status);
  const shown = onlyWaiting ? reports.filter((r) => myStatuses.includes(r.status)) : reports;

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
      <h1>{isClient(profile.role) ? 'My Reports' : 'Reports'}</h1>
      {isClient(profile.role) && (
        <p style={{ color: '#666' }}>Reports from your auditors appear here once they are ready for your review and sign-off.</p>
      )}

      {canPrepareReports(profile.role) && (
        <form onSubmit={handleCreate} style={{ background: 'white', padding: 16, borderRadius: 8, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Start a report</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={engagementId} onChange={(e) => setEngagementId(e.target.value)} required style={{ padding: 8, flex: 1, minWidth: 200 }}>
              <option value="">Choose engagement…</option>
              {engagements.map((eng) => <option key={eng.id} value={eng.id}>{eng.client_name} — {eng.engagement_name}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. JE Testing Findings FY2026" required style={{ padding: 8, flex: 2, minWidth: 200 }} />
            <button type="submit" style={{ padding: '8px 16px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Create draft</button>
          </div>
          {error && <p style={{ color: 'crimson', marginBottom: 0 }}>{error}</p>}
        </form>
      )}

      {!isClient(profile.role) && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={onlyWaiting} onChange={(e) => setOnlyWaiting(e.target.checked)} />
          Only show reports waiting for me
        </label>
      )}

      {shown.length === 0 ? (
        <p style={{ color: '#666' }}>No reports yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ background: 'white', padding: 14, borderRadius: 6, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong>{r.title}</strong>
                  <p style={{ margin: 0, color: '#666', fontSize: 14 }}>
                    {r.engagements?.client_name} — {r.engagements?.engagement_name}
                  </p>
                </div>
                <span style={{ alignSelf: 'center', color: STATUS_COLORS[r.status], whiteSpace: 'nowrap' }}>
                  {r.status}{myStatuses.includes(r.status) ? ' · your turn' : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
