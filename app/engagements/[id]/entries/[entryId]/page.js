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
      <div style={{ maxWidth: 860, margin: '40px auto', padding: 24 }}>
        <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
        <p>{error}</p>
      </div>
    );
  }
  if (!data) return <p style={{ padding: 24, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading the journal entry…</p>;

  const { line, lines, eng, run, flagsByLine, reviews, adjustments } = data;
  const box = { background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 };
  const row = { display: 'flex', gap: 12, padding: '4px 0', fontSize: 14 };
  const label = { width: 150, color: '#666', flexShrink: 0 };
  const flaggedLines = lines.filter((l) => (flagsByLine[l.id] || []).length > 0);
  const lineName = (id) => lines.find((l) => l.id === id)?.account || 'a line';

  return (
    <div style={{ maxWidth: 860, margin: '40px auto', padding: 24 }}>
      <button onClick={back} style={{ background: 'none', border: 'none', color: '#3b4cca', cursor: 'pointer', padding: 0, marginBottom: 16, fontSize: 'inherit', textDecoration: 'underline' }}>
        &larr; Back
      </button>
      <p style={{ color: '#666', margin: 0 }}>{eng?.client_name} — {eng?.engagement_name}</p>
      <h1 style={{ margin: '4px 0 16px' }}>{line.je_number ? `Journal entry ${line.je_number}` : 'Journal entry'}</h1>

      <div style={box}>
        <div style={row}><span style={label}>Posting date</span><span>{line.entry_date}</span></div>
        <div style={row}><span style={label}>Effective date</span><span>{line.effective_date || '—'}</span></div>
        <div style={row}><span style={label}>Prepared by</span><span>{line.entered_by || '—'}</span></div>
        <div style={row}><span style={label}>Source</span><span>{line.source || '—'}</span></div>
        <div style={row}><span style={label}>Lines</span><span>{lines.length}</span></div>
      </div>

      <div style={box}>
        <h3 style={{ marginTop: 0 }}>Lines</h3>
        <JELines lines={lines} highlightId={line.id} flagsByLine={flagsByLine} />
      </div>

      <div style={box}>
        <h3 style={{ marginTop: 0 }}>Flags</h3>
        {!run && <p style={{ color: '#666', margin: 0 }}>No JE testing run has been saved for this engagement yet.</p>}
        {run && flaggedLines.length === 0 && <p style={{ color: '#666', margin: 0 }}>Not flagged in the latest saved run ({new Date(run.run_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })}).</p>}
        {flaggedLines.map((l) => (
          <div key={l.id} style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>{l.account}</strong>
            {flagsByLine[l.id].map((f, i) => (
              <div key={i} style={{ fontSize: 13, marginTop: 4 }}>
                <span style={{ background: '#fdeaea', color: '#a33', padding: '2px 8px', borderRadius: 4, marginRight: 8 }}>{RULE_LABELS[f.rule] || f.rule}</span>
                <span style={{ color: '#666' }}>{f.reason}</span>
              </div>
            ))}
          </div>
        ))}
        {profile && isAuditTeam(profile.role) && flaggedLines.length > 0 && (
          <p style={{ margin: '12px 0 0', fontSize: 14 }}>
            <Link href={`/engagements/${engagementId}/testing`}>Review the flags on Run JE Testing &rarr;</Link>
          </p>
        )}
      </div>

      <div style={box}>
        <h3 style={{ marginTop: 0 }}>Auditor&apos;s decision</h3>
        {reviews.length === 0 && <p style={{ color: '#666', margin: 0 }}>Not reviewed yet.</p>}
        {reviews.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#666' }}>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Line</th>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Decision</th>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px' }}>{lineName(r.journal_entry_id)}</td>
                  <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{DECISIONS[r.disposition] || r.disposition}</td>
                  <td style={{ padding: '6px', color: '#555' }}>{r.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adjustments.length > 0 && (
        <div style={box}>
          <h3 style={{ marginTop: 0 }}>Proposed adjusting entry</h3>
          {adjustments.map((a) => (
            <div key={a.id} style={{ marginBottom: 12 }}>
              <p style={{ margin: '0 0 6px' }}>
                {a.description} · <strong style={{ color: a.status === 'Accepted' ? '#2a7' : a.status === 'Rejected' ? 'crimson' : '#c60' }}>{a.status}</strong>
                {a.client_comment ? ` · client: "${a.client_comment}"` : ''}
              </p>
              <JELines lines={a.lines.map((l, i) => ({ ...l, id: `${a.id}-${i}`, description: '' }))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
