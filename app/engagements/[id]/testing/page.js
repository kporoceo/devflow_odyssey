'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { runJETests, getRuleStatus, groupJournalEntries, RULE_LABELS, DEFAULT_CRITERIA } from '../../../../lib/jeTesting';
import { askAI } from '../../../../lib/ai';
import { fetchAll } from '../../../../lib/fetchAll';
import FlagReview from '../../../../components/FlagReview';
import JELines from '../../../../components/JELines';
import { BackLink, BusyLabel, ClaudeTag, Spinner } from '../../../../components/ui';

const STATUS_STYLE = {
  on: { label: 'Ran', className: 'badge badge-success' },
  off: { label: 'Off', className: 'badge' },
  na: { label: 'Not applicable', className: 'badge badge-warning' },
};

export default function RunJETesting({ params }) {
  const { id: engagementId } = params;
  const [entries, setEntries] = useState([]);
  const [criteria, setCriteria] = useState(null);
  const [holidays, setHolidays] = useState({});
  const [results, setResults] = useState(null); // entries with .flags attached
  const [ruleStatus, setRuleStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [aiNotes, setAiNotes] = useState({});       // entry id -> { risk, explanation, draft_comment }
  const [reviews, setReviews] = useState({});       // entry id -> saved flag_reviews row
  const [adjustments, setAdjustments] = useState({}); // entry id -> adjusting_entries row
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [inactive, setInactive] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { data: entryData } = await fetchAll(() => supabase
        .from('journal_entries')
        .select('*')
        .eq('engagement_id', engagementId)
        .order('created_at', { ascending: true })
        .order('line_no', { ascending: true })
        .order('id', { ascending: true }));

      const { data: eng } = await supabase.from('engagements').select('status').eq('id', engagementId).single();
      setInactive(eng?.status === 'Inactive');

      const { data: criteriaData } = await supabase
        .from('testing_criteria')
        .select('*')
        .eq('engagement_id', engagementId)
        .single();

      const { data: holidayData } = await supabase
        .from('holidays')
        .select('holiday_date, name');

      const { data: reviewData } = await fetchAll(() => supabase
        .from('flag_reviews')
        .select('*')
        .eq('engagement_id', engagementId)
        .order('id', { ascending: true }));
      const { data: adjustmentData } = await supabase
        .from('adjusting_entries')
        .select('*')
        .eq('engagement_id', engagementId);
      setReviews(Object.fromEntries((reviewData || []).map((r) => [r.journal_entry_id, r])));
      setAdjustments(Object.fromEntries((adjustmentData || []).filter((a) => a.journal_entry_id).map((a) => [a.journal_entry_id, a])));

      setEntries(entryData || []);
      // Fall back to the default settings for anything never configured,
      // so "Run JE Testing" still works instead of blocking the user.
      const merged = { ...DEFAULT_CRITERIA };
      if (criteriaData) {
        Object.keys(DEFAULT_CRITERIA).forEach((key) => {
          if (criteriaData[key] !== null && criteriaData[key] !== undefined) merged[key] = criteriaData[key];
        });
      }
      setCriteria(merged);
      const holidayMap = {};
      (holidayData || []).forEach((h) => { holidayMap[h.holiday_date] = h.name; });
      setHolidays(holidayMap);
      setLoading(false);
    }
    load();
  }, [engagementId]);

  function handleRun() {
    setRunning(true);
    setSaveMessage('');
    // Small artificial delay so the UI shows "Running..." even on tiny
    // datasets — on real files this will just reflect actual compute time.
    setTimeout(() => {
      setRuleStatus(getRuleStatus(entries, criteria));
      setResults(runJETests(entries, criteria, holidays));
      setRunning(false);
    }, 300);
  }

  async function handleSaveResults() {
    setSaving(true);
    setSaveMessage('');
    try {
      await saveResults();
    } finally {
      setSaving(false);
    }
  }

  async function saveResults() {
    const { data: { user } } = await supabase.auth.getUser();
    const flaggedEntries = results.filter((r) => r.flags.length > 0);

    const { data: runRow, error: runError } = await supabase
      .from('je_test_results')
      .insert({
        engagement_id: engagementId,
        run_by: user.id,
        total_entries: results.length,
        flagged_count: flaggedEntries.length,
      })
      .select()
      .single();

    if (runError) {
      setSaveMessage(`Error saving results: ${runError.message}`);
      return;
    }

    const flagRows = [];
    flaggedEntries.forEach((entry) => {
      entry.flags.forEach((f) => {
        flagRows.push({
          test_result_id: runRow.id,
          journal_entry_id: entry.id,
          rule: f.rule,
          reason: f.reason,
        });
      });
    });

    // Saved 500 at a time, like the upload, so a large run isn't one huge request.
    for (let i = 0; i < flagRows.length; i += 500) {
      const { error: flagError } = await supabase.from('je_test_flags').insert(flagRows.slice(i, i + 500));
      if (flagError) {
        setSaveMessage(`Results saved, but flags failed: ${flagError.message}`);
        return;
      }
    }

    setSaveMessage(`Saved: ${flaggedEntries.length} of ${results.length} entries flagged.`);
  }

  // The other lines of the same journal entry, for each line.
  // line id -> all the lines of its journal entry, worked out once per load.
  const jeOfLine = useMemo(() => {
    const map = {};
    (groupJournalEntries(entries) || []).forEach((g) => g.forEach((l) => { map[l.id] = g; }));
    return map;
  }, [entries]);

  function linesOfSameJE(entry) {
    return jeOfLine[entry.id] || [entry];
  }

  // Asks the AI about the next 10 flagged lines that don't have a note yet.
  async function explainNext(sorted) {
    const todo = sorted.filter((e) => !aiNotes[e.id]).slice(0, 10);
    if (todo.length === 0) return;
    setAiBusy(true);
    setAiMessage('');
    try {
      const { items } = await askAI(supabase, 'explain_flags', {
        items: todo.map((e) => ({
          ...e,
          other_lines: linesOfSameJE(e).filter((l) => l.id !== e.id),
        })),
      });
      const next = {};
      items.forEach((it) => { next[it.id] = it; });
      setAiNotes((prev) => ({ ...prev, ...next }));
    } catch (err) {
      setAiMessage(err.message);
    }
    setAiBusy(false);
  }

  if (loading) return <p className="loading"><Spinner /> Loading the journal entries…</p>;

  const flagged = results ? results.filter((r) => r.flags.length > 0) : [];
  const countByRule = {};
  flagged.forEach((r) => r.flags.forEach((f) => { countByRule[f.rule] = (countByRule[f.rule] || 0) + 1; }));
  // Riskiest first: entries hitting the most rules, post-closing entries on top.
  const sortedFlagged = [...flagged].sort((a, b) => {
    const score = (r) => r.flags.length + (r.flags.some((f) => f.reason.startsWith('Post-closing')) ? 1 : 0);
    return score(b) - score(a);
  });

  return (
    <div className="page">
      <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
      <div className="page-header">
        <div>
          <h1 className="page-title">Run JE Testing</h1>
          <p className="page-subtitle">
            {loading ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading the journal entries…</span> : `${entries.length} journal entry lines loaded for this engagement.`}
          </p>
        </div>
        {entries.length > 0 && !results && (
          <button
            onClick={handleRun}
            disabled={running}
            className="btn"
            style={{ fontSize: 15, padding: '11px 22px' }}
          >
            <BusyLabel busy={running} busyText="Running the 7 rules…">Run JE Testing</BusyLabel>
          </button>
        )}
      </div>
      {inactive && (
        <p className="alert alert-warning" style={{ marginBottom: 24 }}>
          This engagement is <strong>Inactive</strong>. You can look at the results, but new runs can&apos;t be saved until Firm Leadership reactivates it.
        </p>
      )}

      {!loading && entries.length === 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 24 }}>
          No journal entries found. <Link href={`/engagements/${engagementId}/upload`}>Upload JE data</Link> first.
        </div>
      )}

      {results && (
        <div className="stack-lg">
          <div className="card card-accent row-between">
            <div>
              <p style={{ margin: 0, fontSize: 18 }}>
                <strong>{flagged.length}</strong> of <strong>{results.length}</strong> entries flagged
              </p>
              {saveMessage && <p className={`alert ${saveMessage.startsWith('Error') ? 'alert-danger' : 'alert-success'}`} style={{ margin: '12px 0 0' }}>{saveMessage}</p>}
            </div>
            <div className="row">
              <button onClick={handleRun} className="btn btn-secondary">Re-run</button>
              <button
                onClick={handleSaveResults}
                disabled={saving || inactive}
                className="btn"
              >
                <BusyLabel busy={saving} busyText="Saving…">Save Results</BusyLabel>
              </button>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginBottom: 16 }}>Rules</h2>
            <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Status</th>
                    <th className="num">Flagged</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleStatus.map((s, i) => (
                    <tr key={s.rule}>
                      <td style={{ whiteSpace: 'nowrap' }}>{i + 1}. {RULE_LABELS[s.rule]}</td>
                      <td style={{ whiteSpace: 'nowrap' }}><span className={STATUS_STYLE[s.status].className}>{STATUS_STYLE[s.status].label}</span></td>
                      <td className="num">{s.status === 'on' ? `${countByRule[s.rule] || 0} flagged` : ''}</td>
                      <td className="text-2">{s.status === 'on' && !s.note ? '' : s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {flagged.length > 0 && (
            <div className="card">
              <h2 className="card-title">Review the flags</h2>
              <p className="card-subtitle">
                Riskiest first. For each one, pick your decision and write a comment. Claude can explain a flag and draft
                the comment, but only you decide. {Object.keys(reviews).filter((id) => flagged.some((f) => f.id === id)).length} of {flagged.length} reviewed.
              </p>
              <button
                onClick={() => explainNext(sortedFlagged)}
                disabled={aiBusy || sortedFlagged.every((e) => aiNotes[e.id])}
                className="btn btn-ai"
              >
                <BusyLabel busy={aiBusy} busyText="Claude is explaining…">
                  {sortedFlagged.every((e) => aiNotes[e.id]) ? 'Claude explained every flag' : 'Ask Claude to explain the next 10'}
                </BusyLabel>
              </button>
              {aiBusy && <p className="hint" style={{ marginBottom: 0 }}>This can take up to a minute.</p>}
              {aiMessage && <p className="alert alert-warning" style={{ margin: '12px 0 0' }}>{aiMessage}</p>}
              <p className="muted" style={{ fontSize: 12, margin: '16px 0 0' }}><ClaudeTag />AI features in ODYSSEY use Claude, by Anthropic.</p>
            </div>
          )}

          {flagged.length === 0 ? (
            <p className="muted">No entries were flagged under the current testing criteria.</p>
          ) : (
            <div className="stack">
              {sortedFlagged.map((entry) => (
                <div key={entry.id} className="card" style={{ borderLeft: '3px solid var(--danger)' }}>
                  <div className="row-between" style={{ alignItems: 'baseline' }}>
                    <strong>
                      <Link href={`/engagements/${engagementId}/entries/${entry.id}`}>{entry.je_number ? `JE ${entry.je_number}` : 'Open JE'}</Link>
                      {' · '}{entry.account}
                    </strong>
                    <span className="num" style={{ fontWeight: 500 }}>
                      {entry.debit > 0 ? `Dr ₱${Number(entry.debit).toLocaleString()}` : `Cr ₱${Number(entry.credit).toLocaleString()}`}
                    </span>
                  </div>
                  <p className="text-2 small" style={{ margin: '4px 0 0' }}>
                    {entry.description} — entered {entry.entry_date}
                    {entry.effective_date ? `, effective ${entry.effective_date}` : ''}
                    {entry.entered_by ? `, by ${entry.entered_by}` : ''}
                  </p>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {entry.flags.map((f, i) => (
                      <div key={i} style={{ fontSize: 13 }}>
                        <span className="badge badge-danger" style={{ marginRight: 8 }}>
                          {RULE_LABELS[f.rule] || f.rule}
                        </span>
                        <span className="text-2">{f.reason}</span>
                      </div>
                    ))}
                  </div>
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ fontSize: 13 }}>Show the whole journal entry ({linesOfSameJE(entry).length} lines)</summary>
                    <div style={{ marginTop: 8 }}><JELines lines={linesOfSameJE(entry)} highlightId={entry.id} /></div>
                  </details>
                  <FlagReview
                    engagementId={engagementId}
                    entry={entry}
                    jeLines={linesOfSameJE(entry)}
                    accounts={[...new Set(entries.map((e) => e.account))]}
                    note={aiNotes[entry.id]}
                    review={reviews[entry.id]}
                    adjustment={adjustments[entry.id]}
                    onReviewSaved={(row) => setReviews((prev) => ({ ...prev, [entry.id]: row }))}
                    onAdjustmentSaved={(row) => setAdjustments((prev) => ({ ...prev, [entry.id]: row }))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
