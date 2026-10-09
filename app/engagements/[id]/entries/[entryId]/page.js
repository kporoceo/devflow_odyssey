'use client';

// One journal entry in full: every line, the flags from the latest saved
// JE testing run, the auditor's decisions and any adjusting entry.
// Opened from the JE numbers on Run JE Testing, Testing History and Analytics.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../../lib/supabaseClient';
import { fetchAll } from '../../../../../lib/fetchAll';
import { groupJournalEntries, RULE_LABELS } from '../../../../../lib/jeTesting';
import { useProfile } from '../../../../../components/AppShell';
import { isAuditTeam } from '../../../../../lib/roles';
import { BackLink, Spinner } from '../../../../../components/ui';
import JELines from '../../../../../components/JELines';

const DECISIONS = { Explained: 'Explained (valid)', Error: 'Error (needs adjusting)', Escalate: 'Escalate (possible fraud)' };

export default function JEDetail({ params }) {
  const { id: engagementId, entryId } = params;
  const { profile } = useProfile();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: line } = await supabase.from('journal_entries').select('*').eq('id', entryId).maybeSingle();
      if (!line || line.engagement_id !== engagementId) {
        setError('This journal entry was not found.');
        return;
      }
      // The other lines of the same JE: same JE No., or (without JE numbers)
      // the lines around it in upload order until debits equal credits.
      let lines;
      if (line.je_number) {
        const { data: rows } = await fetchAll(() => supabase.from('journal_entries').select('*')
          .eq('engagement_id', engagementId).eq('je_number', line.je_number).order('line_no').order('id'));
        lines = rows || [line];
      } else {
        const { data: rows } = await fetchAll(() => supabase.from('journal_entries').select('*')
          .eq('engagement_id', engagementId).order('created_at').order('line_no').order('id'));
        lines = (groupJournalEntries(rows || []) || []).find((g) => g.some((l) => l.id === line.id)) || [line];
      }
      const ids = lines.map((l) => l.id);

      const { data: eng } = await supabase.from('engagements').select('client_name, engagement_name').eq('id', engagementId).single();
      const { data: run } = await supabase.from('je_test_results').select('id, run_at')
        .eq('engagement_id', engagementId).order('run_at', { ascending: false }).limit(1).maybeSingle();
      const { data: flags } = run
        ? await supabase.from('je_test_flags').select('journal_entry_id, rule, reason').eq('test_result_id', run.id).in('journal_entry_id', ids)
        : { data: [] };
      const { data: reviews } = await supabase.from('flag_reviews').select('*').in('journal_entry_id', ids);
      const { data: adjustments } = await supabase.from('adjusting_entries').select('*').in('journal_entry_id', ids);

      const flagsByLine = {};
      (flags || []).forEach((f) => { (flagsByLine[f.journal_entry_id] = flagsByLine[f.journal_entry_id] || []).push(f); });
      setData({ line, lines, eng, run, flagsByLine, reviews: reviews || [], adjustments: adjustments || [] });
    }
    load();
  }, [engagementId, entryId]);

  const back = () => (typeof window !== 'undefined' && window.history.length > 1 ? router.back() : router.push(`/engagements/${engagementId}`));

  if (error) {
    return (
      <div className="page page-narrow" style={{ maxWidth: 900 }}>
        <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }
  if (!data) return <p className="loading"><Spinner /> Loading the journal entry…</p>;

  const { line, lines, eng, run, flagsByLine, reviews, adjustments } = data;
  const row = { display: 'flex', gap: 16, padding: '8px 0', fontSize: 14, borderBottom: '1px solid var(--border)' };
  const lastRow = { ...row, borderBottom: 'none' };
  const label = { width: 160, color: 'var(--text-2)', flexShrink: 0 };
  const flaggedLines = lines.filter((l) => (flagsByLine[l.id] || []).length > 0);
  const lineName = (id) => lines.find((l) => l.id === id)?.account || 'a line';
  const statusBadge = (status) => (status === 'Accepted' ? 'badge badge-success' : status === 'Rejected' ? 'badge badge-danger' : 'badge badge-warning');

  return (
    <div className="page page-narrow" style={{ maxWidth: 900 }}>
      <button onClick={back} className="back-link" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: 14 }}>
        &larr; Back
      </button>
      <div className="page-header">
        <div>
          <p className="text-2" style={{ margin: '0 0 4px', fontSize: 14 }}>{eng?.client_name} — {eng?.engagement_name}</p>
          <h1 className="page-title">{line.je_number ? `Journal entry ${line.je_number}` : 'Journal entry'}</h1>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div style={row}><span style={label}>Posting date</span><span>{line.entry_date}</span></div>
          <div style={row}><span style={label}>Effective date</span><span>{line.effective_date || '—'}</span></div>
          <div style={row}><span style={label}>Prepared by</span><span>{line.entered_by || '—'}</span></div>
          <div style={row}><span style={label}>Source</span><span>{line.source || '—'}</span></div>
          <div style={lastRow}><span style={label}>Lines</span><span>{lines.length}</span></div>
        </div>

        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 16 }}>Lines</h3>
          <JELines lines={lines} highlightId={line.id} flagsByLine={flagsByLine} />
        </div>

        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 16 }}>Flags</h3>
          {!run && <p className="muted" style={{ margin: 0 }}>No JE testing run has been saved for this engagement yet.</p>}
          {run && flaggedLines.length === 0 && <p className="muted" style={{ margin: 0 }}>Not flagged in the latest saved run ({new Date(run.run_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })}).</p>}
          {flaggedLines.map((l) => (
            <div key={l.id} style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: 14, fontWeight: 600 }}>{l.account}</strong>
              {flagsByLine[l.id].map((f, i) => (
                <div key={i} style={{ fontSize: 13, marginTop: 6, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="badge badge-danger">{RULE_LABELS[f.rule] || f.rule}</span>
                  <span className="text-2">{f.reason}</span>
                </div>
              ))}
            </div>
          ))}
          {profile && isAuditTeam(profile.role) && flaggedLines.length > 0 && (
            <p style={{ margin: '16px 0 0', fontSize: 14 }}>
              <Link href={`/engagements/${engagementId}/testing`}>Review the flags on Run JE Testing &rarr;</Link>
            </p>
          )}
        </div>

        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 16 }}>Auditor&apos;s decision</h3>
          {reviews.length === 0 && <p className="muted" style={{ margin: 0 }}>Not reviewed yet.</p>}
          {reviews.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Decision</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td>{lineName(r.journal_entry_id)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{DECISIONS[r.disposition] || r.disposition}</td>
                      <td className="text-2">{r.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {adjustments.length > 0 && (
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Proposed adjusting entry</h3>
            {adjustments.map((a) => (
              <div key={a.id} style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px' }}>
                  {a.description} · <span className={statusBadge(a.status)}>{a.status}</span>
                  {a.client_comment ? ` · client: "${a.client_comment}"` : ''}
                </p>
                <JELines lines={a.lines.map((l, i) => ({ ...l, id: `${a.id}-${i}`, description: '' }))} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
