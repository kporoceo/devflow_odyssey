'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { RULE_LABELS } from '../../../../lib/jeTesting';
import { fetchAll } from '../../../../lib/fetchAll';
import { BackLink, Spinner } from '../../../../components/ui';

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
      const { data, error } = await fetchAll(() => supabase
        .from('je_test_flags')
        .select('*, journal_entries(je_number, account, description, entry_date, debit, credit)')
        .eq('test_result_id', runId)
        .order('id'));

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

  if (loading) return <p className="loading"><Spinner /> Loading…</p>;

  return (
    <div className="page page-narrow" style={{ maxWidth: 960 }}>
      <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
      <div className="page-header">
        <div>
          <h1 className="page-title">Testing History &amp; Audit Trail</h1>
          <p className="page-subtitle">
            A record of every JE testing run performed on this engagement — who ran it, when, and what was flagged.
          </p>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="alert alert-warning">
          No testing runs yet. <Link href={`/engagements/${engagementId}/testing`}>Run JE Testing</Link> to create the first entry in this audit trail.
        </div>
      ) : (
        <div className="stack">
          {runs.map((run) => (
            <div key={run.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                onClick={() => toggleRun(run.id)}
                className="row-between"
                style={{ padding: '18px 24px', cursor: 'pointer' }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{formatDate(run.run_at)}</p>
                  <p className="text-2 small" style={{ margin: '4px 0 0' }}>
                    Run by {run.profiles?.full_name || 'Unknown'} ({run.profiles?.role || 'n/a'})
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0 }}>
                    <span className={run.flagged_count > 0 ? 'text-danger' : 'text-success'} style={{ fontWeight: 600 }}>
                      {run.flagged_count}
                    </span> / {run.total_entries} flagged
                  </p>
                  <p className="small" style={{ margin: '4px 0 0', color: 'var(--link)' }}>
                    {expandedRunId === run.id ? 'Hide details ▲' : 'View details ▼'}
                  </p>
                </div>
              </div>

              {expandedRunId === run.id && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '20px 24px', background: 'var(--surface-2)' }}>
                  {loadingFlags && !flagsByRun[run.id] ? (
                    <p className="text-2" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}><Spinner /> Loading flags…</p>
                  ) : flagsByRun[run.id]?.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>No entries were flagged in this run.</p>
                  ) : (
                    <div>
                      <p className="hint" style={{ margin: '0 0 12px' }}>Click a JE number to see the whole entry, its decision and any adjusting entry.</p>
                      <div className="table-wrap">
                        <table className="compact">
                          <thead>
                            <tr>
                              {['JE No.', 'Date', 'Account title', 'Description', 'Amount (₱)', 'Rule', 'Reason'].map((h) => (
                                <th key={h} className={h.startsWith('Amount') ? 'num' : undefined}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {flagsByRun[run.id]?.map((flag) => {
                              const je = flag.journal_entries || {};
                              const amount = Number(je.debit) > 0 ? Number(je.debit) : Number(je.credit || 0);
                              return (
                                <tr key={flag.id}>
                                  <td style={{ whiteSpace: 'nowrap' }}>
                                    <Link href={`/engagements/${engagementId}/entries/${flag.journal_entry_id}`}>{je.je_number || 'Open'}</Link>
                                  </td>
                                  <td style={{ whiteSpace: 'nowrap' }}>{je.entry_date}</td>
                                  <td>{je.account}</td>
                                  <td className="text-2">{je.description}</td>
                                  <td className="num">
                                    {amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })} {Number(je.debit) > 0 ? 'Dr' : 'Cr'}
                                  </td>
                                  <td>
                                    <span className="badge badge-danger">{RULE_LABELS[flag.rule] || flag.rule}</span>
                                  </td>
                                  <td className="text-2">{flag.reason}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
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
