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
  on: { label: 'Ran', color: '#2a7' },
  off: { label: 'Off', color: '#888' },
  na: { label: 'Not applicable', color: '#a70' },
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

  if (loading) return <p style={{ padding: 24, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading the journal entries…</p>;

  const flagged = results ? results.filter((r) => r.flags.length > 0) : [];
  const countByRule = {};
  flagged.forEach((r) => r.flags.forEach((f) => { countByRule[f.rule] = (countByRule[f.rule] || 0) + 1; }));
  // Riskiest first: entries hitting the most rules, post-closing entries on top.
  const sortedFlagged = [...flagged].sort((a, b) => {
    const score = (r) => r.flags.length + (r.flags.some((f) => f.reason.startsWith('Post-closing')) ? 1 : 0);
    return score(b) - score(a);
  });

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
      <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
      <h1>Run JE Testing</h1>
      {inactive && (
        <p style={{ background: '#f3f3f3', padding: 12, borderRadius: 6 }}>
          This engagement is <strong>Inactive</strong>. You can look at the results, but new runs can&apos;t be saved until Firm Leadership reactivates it.
        </p>
      )}
      <p style={{ color: '#666' }}>
        {loading ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading the journal entries…</span> : `${entries.length} journal entry lines loaded for this engagement.`}
      </p>

      {!loading && entries.length === 0 && (
        <div style={{ background: '#fff8e6', border: '1px solid #e8c468', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          No journal entries found. <Link href={`/engagements/${engagementId}/upload`}>Upload JE data</Link> first.
        </div>
      )}

      {entries.length > 0 && !results && (
        <button
          onClick={handleRun}
          disabled={running}
          style={{ padding: '12px 24px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 16 }}
        >
          <BusyLabel busy={running} busyText="Running the 7 rules…">Run JE Testing</BusyLabel>
        </button>
      )}

      {results && (
        <div>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: 18 }}>
                <strong>{flagged.length}</strong> of <strong>{results.length}</strong> entries flagged
              </p>
              {saveMessage && <p style={{ margin: '8px 0 0', color: saveMessage.startsWith('Error') ? 'crimson' : '#2a7' }}>{saveMessage}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleRun} style={{ padding: '8px 16px', cursor: 'pointer' }}>Re-run</button>
              <button
                onClick={handleSaveResults}
                disabled={saving || inactive}
                style={{ padding: '8px 16px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                <BusyLabel busy={saving} busyText="Saving…">Save Results</BusyLabel>
              </button>
            </div>
          </div>

          <div style={{ background: 'white', padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <strong>Rules</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#666' }}>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>Rule</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>Status</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500, textAlign: 'right' }}>Flagged</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {ruleStatus.map((s, i) => (
                  <tr key={s.rule} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{i + 1}. {RULE_LABELS[s.rule]}</td>
                    <td style={{ padding: '6px 4px', color: STATUS_STYLE[s.status].color, whiteSpace: 'nowrap' }}>{STATUS_STYLE[s.status].label}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{s.status === 'on' ? `${countByRule[s.rule] || 0} flagged` : ''}</td>
                    <td style={{ padding: '6px 4px', color: '#666' }}>{s.status === 'on' && !s.note ? '' : s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {flagged.length > 0 && (
            <div style={{ background: 'white', padding: 16, borderRadius: 8, marginBottom: 16 }}>
              <strong>Review the flags</strong>
              <p style={{ color: '#666', fontSize: 14, margin: '4px 0 12px' }}>
                Riskiest first. For each one, pick your decision and write a comment. Claude can explain a flag and draft
                the comment, but only you decide. {Object.keys(reviews).filter((id) => flagged.some((f) => f.id === id)).length} of {flagged.length} reviewed.
              </p>
              <button
                onClick={() => explainNext(sortedFlagged)}
                disabled={aiBusy || sortedFlagged.every((e) => aiNotes[e.id])}
                style={{ padding: '8px 14px', background: '#3b4cca', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                <BusyLabel busy={aiBusy} busyText="Claude is explaining…">
                  {sortedFlagged.every((e) => aiNotes[e.id]) ? 'Claude explained every flag' : 'Ask Claude to explain the next 10'}
                </BusyLabel>
              </button>
              {aiBusy && <p style={{ fontSize: 13, color: '#666', marginBottom: 0 }}>This can take up to a minute.</p>}
              {aiMessage && <p style={{ color: '#a70', marginBottom: 0 }}>{aiMessage}</p>}
              <p style={{ fontSize: 12, color: '#666', marginBottom: 0 }}><ClaudeTag />AI features in ODYSSEY use Claude, by Anthropic.</p>
            </div>
          )}

          {flagged.length === 0 ? (
            <p style={{ color: '#666' }}>No entries were flagged under the current testing criteria.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sortedFlagged.map((entry) => (
                <div key={entry.id} style={{ background: 'white', padding: 16, borderRadius: 8, borderLeft: '4px solid crimson' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>
                      <Link href={`/engagements/${engagementId}/entries/${entry.id}`}>{entry.je_number ? `JE ${entry.je_number}` : 'Open JE'}</Link>
                      {' · '}{entry.account}
                    </strong>
                    <span>
                      {entry.debit > 0 ? `Dr ₱${Number(entry.debit).toLocaleString()}` : `Cr ₱${Number(entry.credit).toLocaleString()}`}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0', color: '#666' }}>
                    {entry.description} — entered {entry.entry_date}
                    {entry.effective_date ? `, effective ${entry.effective_date}` : ''}
                    {entry.entered_by ? `, by ${entry.entered_by}` : ''}
                  </p>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {entry.flags.map((f, i) => (
                      <div key={i} style={{ fontSize: 13 }}>
                        <span style={{ background: '#fdeaea', color: '#a33', padding: '2px 8px', borderRadius: 4, marginRight: 8 }}>
                          {RULE_LABELS[f.rule] || f.rule}
                        </span>
                        <span style={{ color: '#666' }}>{f.reason}</span>
                      </div>
                    ))}
                  </div>
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13, color: '#3b4cca' }}>Show the whole journal entry ({linesOfSameJE(entry).length} lines)</summary>
                    <div style={{ marginTop: 6 }}><JELines lines={linesOfSameJE(entry)} highlightId={entry.id} /></div>
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
