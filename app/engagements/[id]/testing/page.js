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

// The uploaded lines, 25 per page, so the page isn't empty before a run.
const PAGE_SIZE = 25;
const money = (n) => (Number(n) > 0 ? Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

function EntriesTable({ entries }) {
  const [pageNo, setPageNo] = useState(0);
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const shown = entries.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE);
  return (
    <>
      <div className="table-wrap">
        <table className="compact" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>JE No.</th>
              <th>Entry date</th>
              <th>Account title</th>
              <th>Description</th>
              <th className="num">Debit (₱)</th>
              <th className="num">Credit (₱)</th>
              <th>Prepared by</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{e.je_number || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{e.entry_date}</td>
                <td>{e.account}</td>
                <td className="text-2">{e.description}</td>
                <td className="num">{money(e.debit)}</td>
                <td className="num">{money(e.credit)}</td>
                <td className="text-2">{e.entered_by || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-between" style={{ marginTop: 12 }}>
        <span className="muted small">
          Lines {(pageNo * PAGE_SIZE + 1).toLocaleString()}–{Math.min((pageNo + 1) * PAGE_SIZE, entries.length).toLocaleString()} of {entries.length.toLocaleString()}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={() => setPageNo(0)} disabled={pageNo === 0} className="btn btn-secondary btn-sm">First</button>
          <button onClick={() => setPageNo(pageNo - 1)} disabled={pageNo === 0} className="btn btn-secondary btn-sm">Previous</button>
          <span className="small text-2">Page {pageNo + 1} of {pages.toLocaleString()}</span>
          <button onClick={() => setPageNo(pageNo + 1)} disabled={pageNo >= pages - 1} className="btn btn-secondary btn-sm">Next</button>
        </div>
      </div>
    </>
  );
}

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

  // Asks the AI about the next 10 flagged journal entries that don't have a note yet.
  // Each JE is sent once, as its first flagged line plus the JE's other lines.
  async function explainNext(groups) {
    const todo = groups.map((g) => g.rep).filter((e) => !aiNotes[e.id]).slice(0, 10);
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
  // One review card per journal entry. Most rules flag every line of the JE
  // (a weekend posting is the same for the debit and the credit), so the
  // flagged lines of a JE are reviewed together and its repeated flags shown once.
  const groupMap = new Map();
  flagged.forEach((line) => {
    const lines = linesOfSameJE(line);
    const key = lines[0].id;
    if (!groupMap.has(key)) groupMap.set(key, { key, lines, flaggedLines: [], flags: [] });
    const g = groupMap.get(key);
    g.flaggedLines.push(line);
    line.flags.forEach((f) => {
      if (!g.flags.some((x) => x.rule === f.rule && x.reason === f.reason)) g.flags.push(f);
    });
  });
  const groups = [...groupMap.values()].map((g) => {
    const rep = g.flaggedLines[0];
    const reviewedLine = g.flaggedLines.find((l) => reviews[l.id]);
    const adjustedLine = g.flaggedLines.find((l) => adjustments[l.id]);
    return {
      ...g,
      rep,
      review: reviewedLine ? reviews[reviewedLine.id] : undefined,
      adjustment: adjustedLine ? adjustments[adjustedLine.id] : undefined,
      amount: g.lines.reduce((sum, l) => sum + Number(l.debit || 0), 0),
      flagsByLine: Object.fromEntries(g.flaggedLines.map((l) => [l.id, l.flags])),
    };
  });
  // Riskiest first: JEs hitting the most rules, post-closing entries on top.
  const score = (g) => new Set(g.flags.map((f) => f.rule)).size + (g.flags.some((f) => f.reason.startsWith('Post-closing')) ? 1 : 0);
  const sortedGroups = groups.sort((a, b) => score(b) - score(a));
  const reviewedGroups = sortedGroups.filter((g) => g.review).length;
  const reviewedPct = sortedGroups.length ? Math.round((reviewedGroups / sortedGroups.length) * 100) : 0;

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

      {entries.length > 0 && !results && (
        <div className="card">
          <h2 className="card-title">Uploaded entries</h2>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>These are the lines the 7 rules will check. Click <strong>Run JE Testing</strong> when you&apos;re ready.</p>
          <EntriesTable entries={entries} />
        </div>
      )}

      {results && (
        <div className="stack-lg">
          <div className="card card-accent row-between">
            <div>
              <p style={{ margin: 0, fontSize: 18 }}>
                <strong>{flagged.length}</strong> of <strong>{results.length}</strong> entries flagged
                {flagged.length > 0 && <span className="text-2" style={{ fontSize: 15 }}> · {sortedGroups.length} journal entries to review</span>}
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
                Riskiest first, one card per journal entry. For each one, pick your decision and write a comment. Claude can explain a flag and draft
                the comment, but only you decide.
              </p>
              <div style={{ margin: '4px 0 20px' }}>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <span className="small text-2"><strong>{reviewedGroups}</strong> of <strong>{sortedGroups.length}</strong> journal entries reviewed</span>
                  <span className="small text-2">{reviewedPct}%</span>
                </div>
                <div className="progress" style={{ height: 8 }}>
                  <span style={{ width: `${reviewedPct}%`, background: reviewedPct === 100 ? 'var(--success)' : 'var(--primary)' }} />
                </div>
              </div>
              <button
                onClick={() => explainNext(sortedGroups)}
                disabled={aiBusy || sortedGroups.every((g) => aiNotes[g.rep.id])}
                className="btn btn-ai"
              >
                <BusyLabel busy={aiBusy} busyText="Claude is explaining…">
                  {sortedGroups.every((g) => aiNotes[g.rep.id]) ? 'Claude explained every flag' : 'Ask Claude to explain the next 10'}
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
              {sortedGroups.map((g) => (
                <div key={g.key} className="card" style={{ borderLeft: `3px solid ${g.review ? 'var(--success)' : 'var(--danger)'}` }}>
                  <div className="row-between" style={{ alignItems: 'baseline' }}>
                    <strong>
                      <Link href={`/engagements/${engagementId}/entries/${g.rep.id}`}>{g.rep.je_number || 'Open JE'}</Link>
                      {' · '}{g.rep.description}
                    </strong>
                    <span className="num" style={{ fontWeight: 500 }}>₱{g.amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <p className="text-2 small" style={{ margin: '4px 0 0' }}>
                    Entered {g.rep.entry_date}
                    {g.rep.effective_date ? `, effective ${g.rep.effective_date}` : ''}
                    {g.rep.entered_by ? `, by ${g.rep.entered_by}` : ''}
                    {` · ${g.flaggedLines.length} of ${g.lines.length} lines flagged`}
                  </p>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {g.flags.map((f, i) => (
                      <div key={i} style={{ fontSize: 13 }}>
                        <span className="badge badge-danger" style={{ marginRight: 8 }}>
                          {RULE_LABELS[f.rule] || f.rule}
                        </span>
                        <span className="text-2">{f.reason}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <JELines lines={g.lines} flagsByLine={g.flagsByLine} />
                  </div>
                  <FlagReview
                    engagementId={engagementId}
                    entry={g.rep}
                    entryIds={g.flaggedLines.map((l) => l.id)}
                    jeLines={g.lines}
                    accounts={[...new Set(entries.map((e) => e.account))]}
                    note={aiNotes[g.rep.id]}
                    review={g.review}
                    adjustment={g.adjustment}
                    onReviewSaved={(rows) => setReviews((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.journal_entry_id, r])) }))}
                    onAdjustmentSaved={(row) => setAdjustments((prev) => ({ ...prev, [g.rep.id]: row }))}
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
