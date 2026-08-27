'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { RULE_LABELS } from '../../../../lib/jeTesting';

export default function TestingHistory({ params }) {
  const { id: engagementId } = params;
  const [runs, setRuns] = useState([]);
  const [expandedRunId, setExpandedRunId] = useState(null);
  const [flagsByRun, setFlagsByRun] = useState({}); // cache: { [runId]: [flag rows with entry data] }
  const [loading, setLoading] = useState(true);
  const [loadingFlags, setLoadingFlags] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // Pull each run, plus the display name/role of whoever ran it.
      const { data, error } = await supabase
        .from('je_test_results')
        .select('*, profiles(full_name, role)')
        .eq('engagement_id', engagementId)
        .order('run_at', { ascending: false });

      if (!error) setRuns(data || []);
      setLoading(false);
    }
    load();
  }, [engagementId]);

  async function toggleRun(runId) {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);

    // Only fetch flags the first time a run is expanded; cache after that.
    if (!flagsByRun[runId]) {
      setLoadingFlags(true);
      const { data, error } = await supabase
        .from('je_test_flags')
        .select('*, journal_entries(account, description, entry_date, debit, credit)')
        .eq('test_result_id', runId);

      if (!error) {
        setFlagsByRun((prev) => ({ ...prev, [runId]: data || [] }));
      }
      setLoadingFlags(false);
    }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  if (loading) return <p style={{ padding: 24 }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
      <Link href={`/engagements/${engagementId}`} style={{ display: 'inline-block', marginBottom: 16 }}>
        &larr; Back to Engagement
      </Link>
      <h1>Testing History &amp; Audit Trail</h1>
      <p style={{ color: '#666' }}>
        A record of every JE testing run performed on this engagement — who ran it, when, and what was flagged.
      </p>

      {runs.length === 0 ? (
        <div style={{ background: '#fff8e6', border: '1px solid #e8c468', padding: 16, borderRadius: 8 }}>
          No testing runs yet. <Link href={`/engagements/${engagementId}/testing`}>Run JE Testing</Link> to create the first entry in this audit trail.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {runs.map((run) => (
            <div key={run.id} style={{ background: 'white', borderRadius: 8, overflow: 'hidden' }}>
              <div
                onClick={() => toggleRun(run.id)}
                style={{ padding: 16, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 'bold' }}>{formatDate(run.run_at)}</p>
                  <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>
                    Run by {run.profiles?.full_name || 'Unknown'} ({run.profiles?.role || 'n/a'})
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0 }}>
                    <span style={{ color: run.flagged_count > 0 ? 'crimson' : '#2a7', fontWeight: 'bold' }}>
                      {run.flagged_count}
                    </span> / {run.total_entries} flagged
                  </p>
                  <p style={{ margin: '4px 0 0', color: '#999', fontSize: 13 }}>
                    {expandedRunId === run.id ? 'Hide details ▲' : 'View details ▼'}
                  </p>
                </div>
              </div>

              {expandedRunId === run.id && (
                <div style={{ borderTop: '1px solid #eee', padding: 16, background: '#fafafa' }}>
                  {loadingFlags && !flagsByRun[run.id] ? (
                    <p>Loading flags...</p>
                  ) : flagsByRun[run.id]?.length === 0 ? (
                    <p style={{ color: '#666', margin: 0 }}>No entries were flagged in this run.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {flagsByRun[run.id]?.map((flag) => (
                        <div key={flag.id} style={{ background: 'white', padding: 10, borderRadius: 6, borderLeft: '3px solid crimson', fontSize: 14 }}>
                          <strong>{flag.journal_entries?.account}</strong>
                          {' — '}
                          {flag.journal_entries?.description} ({flag.journal_entries?.entry_date})
                          <div style={{ marginTop: 4 }}>
                            <span style={{ background: '#fdeaea', color: '#a33', padding: '2px 8px', borderRadius: 4, marginRight: 8, fontSize: 12 }}>
                              {RULE_LABELS[flag.rule] || flag.rule}
                            </span>
                            <span style={{ color: '#666', fontSize: 13 }}>{flag.reason}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
