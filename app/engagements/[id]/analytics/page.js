'use client';

// Analytics for one engagement, modelled on Arch's "UK SOX Journal
// Entries" Power BI dashboard: the same 7 pages (Trending, Potential SOD,
// Cutoff, Posting Date Lag, Activity Map, Duplicate JEs, Weekend JEs), the
// same filter row and number tiles, plus an ODYSSEY page for the flags and
// the auditors' decisions. Everything is worked out in the browser from
// the engagement's journal entries, so it always matches the latest upload.
// Audit Team and Firm Leadership only (AppShell enforces it; the database
// already limits journal entries to firm staff).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { runJETests, groupJournalEntries, classifyAccount, RULE_LABELS, RULE_ORDER, DEFAULT_CRITERIA } from '../../../../lib/jeTesting';
import { askAI } from '../../../../lib/ai';
import { BackLink, BusyLabel, ClaudeTag, Spinner } from '../../../../components/ui';
import { fetchAll } from '../../../../lib/fetchAll';
import { Panel, Tile, Legend, ColumnChart, BarList, HeatTable, DataTable, peso, pesoShort, BLUE, ORANGE } from '../../../../components/charts';

const PAGES = ['Trending', 'Potential SOD', 'Cutoff', 'Posting Date Lag', 'Activity Map', 'Duplicate JEs', 'Weekend JEs', 'Flags & Review'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, like Arch
const ALL = '(All)';

const dayMs = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const weekdayOf = (s) => new Date(dayMs(s)).getUTCDay();
const monthLabel = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1))
  .toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const quarterOf = (s) => `${s.slice(0, 4)}-Q${Math.floor((Number(s.slice(5, 7)) - 1) / 3) + 1}`;
const count = (n) => Number(n || 0).toLocaleString('en-PH');
const pct = (n) => `${(n * 100).toFixed(1)}%`;

// Every month from the first to the last, so months with no entries still show.
function monthRange(list) {
  if (list.length === 0) return [];
  const sorted = [...list].sort();
  let y = Number(sorted[0].slice(0, 4));
  let m = Number(sorted[0].slice(5, 7));
  const out = [];
  while (out.length < 60) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= sorted[sorted.length - 1]) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function sumBy(items, keyFn, valFn) {
  const out = {};
  items.forEach((it) => {
    const k = keyFn(it);
    out[k] = (out[k] || 0) + valFn(it);
  });
  return out;
}

// Turns the lines into journal entries (one JE = its balancing lines).
function buildJEs(entries, flagsById, holidays) {
  const groups = groupJournalEntries(entries) || entries.map((e) => [e]);
  return groups.map((groupLines) => {
    const lines = groupLines.map((l) => ({ ...l, flags: flagsById[l.id] || [] }));
    const first = lines[0];
    const entryDate = String(first.entry_date).slice(0, 10);
    const effective = first.effective_date ? String(first.effective_date).slice(0, 10) : null;
    const acctDate = effective || entryDate;
    const wd = weekdayOf(entryDate);
    const flags = lines.flatMap((l) => l.flags);
    return {
      key: first.je_number || `Line ${first.line_no ?? ''}`.trim(),
      firstId: first.id,
      lines,
      amount: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
      entryDate,
      effective,
      acctDate,
      month: acctDate.slice(0, 7),
      weekday: wd,
      weekend: wd === 0 || wd === 6,
      holiday: holidays[entryDate] || null,
      lag: effective ? Math.round((dayMs(entryDate) - dayMs(effective)) / 86400000) : null,
      preparer: first.entered_by || '(not given)',
      source: first.source || '(not given)',
      memo: first.description || '',
      classes: [...new Set(lines.map((l) => classifyAccount(l)))],
      flags,
      rules: [...new Set(flags.map((f) => f.rule))],
    };
  });
}

function toCSV(rows) {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export default function Analytics({ params }) {
  const { id: engagementId } = params;
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [engagement, setEngagement] = useState(null);
  const [entries, setEntries] = useState([]);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [holidays, setHolidays] = useState({});
  const [reviews, setReviews] = useState({});
  const [adjustments, setAdjustments] = useState([]);
  const [page, setPage] = useState(PAGES[0]);
  const [filters, setFilters] = useState({ source: ALL, day: ALL, preparer: ALL, month: ALL, accountType: ALL });
  const [threshold, setThreshold] = useState(100000);
  const [aiNotes, setAiNotes] = useState({});
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');

  useEffect(() => {
    async function load() {
      const { data: eng } = await supabase.from('engagements').select('client_name, engagement_name').eq('id', engagementId).single();
      const { data: entryData } = await fetchAll(() => supabase
        .from('journal_entries')
        .select('*')
        .eq('engagement_id', engagementId)
        .order('created_at', { ascending: true })
        .order('line_no', { ascending: true })
        .order('id', { ascending: true }));
      const { data: criteriaData } = await supabase.from('testing_criteria').select('*').eq('engagement_id', engagementId).maybeSingle();
      const { data: holidayData } = await supabase.from('holidays').select('holiday_date, name');
      const { data: reviewData } = await fetchAll(() => supabase.from('flag_reviews').select('id, journal_entry_id, disposition, comment').eq('engagement_id', engagementId).order('id'));
      const { data: adjData } = await supabase.from('adjusting_entries').select('status').eq('engagement_id', engagementId);

      const merged = { ...DEFAULT_CRITERIA };
      if (criteriaData) {
        Object.keys(DEFAULT_CRITERIA).forEach((k) => {
          if (criteriaData[k] !== null && criteriaData[k] !== undefined) merged[k] = criteriaData[k];
        });
      }
      setEngagement(eng);
      setEntries(entryData || []);
      setCriteria(merged);
      setHolidays(Object.fromEntries((holidayData || []).map((h) => [h.holiday_date, h.name])));
      setReviews(Object.fromEntries((reviewData || []).map((r) => [r.journal_entry_id, r])));
      setAdjustments(adjData || []);
      // Start the Activity Map at the round-amount threshold from Testing Criteria.
      if (Number(merged.round_min_amount) > 0) setThreshold(Number(merged.round_min_amount));
      setLoading(false);
    }
    load();
  }, [engagementId]);

  // Run the 7 rules once, the same way the Run JE Testing page does.
  const allJEs = useMemo(() => {
    if (entries.length === 0) return [];
    const results = runJETests(entries, criteria, holidays);
    const flagsById = Object.fromEntries(results.map((r) => [r.id, r.flags]));
    return buildJEs(entries, flagsById, holidays);
  }, [entries, criteria, holidays]);

  const options = useMemo(() => ({
    source: [...new Set(allJEs.map((j) => j.source))].sort(),
    preparer: [...new Set(allJEs.map((j) => j.preparer))].sort(),
    month: [...new Set(allJEs.map((j) => j.month))].sort(),
    accountType: [...new Set(allJEs.flatMap((j) => j.classes))].sort(),
  }), [allJEs]);

  const jes = useMemo(() => allJEs.filter((j) =>
    (filters.source === ALL || j.source === filters.source)
    && (filters.day === ALL || DAYS[j.weekday] === filters.day)
    && (filters.preparer === ALL || j.preparer === filters.preparer)
    && (filters.month === ALL || j.month === filters.month)
    && (filters.accountType === ALL || j.classes.includes(filters.accountType))), [allJEs, filters]);

  // The AI's notes describe the numbers it was given, so clear them when the view changes.
  useEffect(() => { setAiNotes({}); }, [filters, threshold]);

  if (loading) return <p style={{ padding: 24, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading the journal entries…</p>;

  const total = jes.reduce((s, j) => s + j.amount, 0);
  const months = monthRange([...new Set(jes.map((j) => j.month))]);
  const hasEffective = allJEs.some((j) => j.effective);
  const memoColumns = [
    { key: 'key', label: 'JE No.', format: (v, r) => <Link href={`/engagements/${engagementId}/entries/${r.firstId}`}>{v}</Link> },
    { key: 'memo', label: 'Memo', wrap: true },
    { key: 'entryDate', label: 'Posted' },
    { key: 'acctDate', label: 'Accounting date' },
    { key: 'preparer', label: 'Prepared by' },
    { key: 'amount', label: 'Debit amount', align: 'right', format: peso },
  ];

  // ---- One function per page: tiles, panels, and a short summary for the AI note.
  function trending() {
    const byMonth = sumBy(jes, (j) => j.month, (j) => j.amount);
    const busiest = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
    const preparers = [...new Set(jes.map((j) => j.preparer))].sort();
    const sources = [...new Set(jes.map((j) => j.source))].sort();
    const prepMonth = sumBy(jes, (j) => `${j.preparer}|${j.month}`, (j) => j.amount);
    const prepSource = sumBy(jes, (j) => `${j.preparer}|${j.source}`, (j) => j.amount);
    return {
      third: { title: 'Busiest month', value: busiest ? monthLabel(busiest[0]) : '–', sub: busiest ? pesoShort(busiest[1]) : '' },
      body: (
        <>
          <Panel title="JE amount by accounting date">
            <ColumnChart data={months.map((m) => ({ label: monthLabel(m), value: byMonth[m] || 0 }))} />
          </Panel>
          <Panel title="Activity by preparer and accounting month">
            <HeatTable rowHeader="Prepared by" rowLabels={preparers} colLabels={months.map(monthLabel)}
              value={(r, c) => prepMonth[`${r}|${months[months.map(monthLabel).indexOf(c)]}`]} />
          </Panel>
          <Panel title="Activity by preparer and source">
            <HeatTable rowHeader="Prepared by" rowLabels={preparers} colLabels={sources} value={(r, c) => prepSource[`${r}|${c}`]} />
          </Panel>
          <Panel title="Memo with debits"><DataTable columns={memoColumns} rows={[...jes].sort((a, b) => b.amount - a.amount)} /></Panel>
        </>
      ),
      summary: { amount_by_month: Object.fromEntries(months.map((m) => [monthLabel(m), Math.round(byMonth[m] || 0)])), amount_by_preparer: sumBy(jes, (j) => j.preparer, (j) => Math.round(j.amount)) },
    };
  }

  function potentialSOD() {
    const sod = jes.filter((j) => j.rules.includes('sod'));
    const byMonth = sumBy(sod, (j) => j.month, () => 1);
    const byPrep = sumBy(sod, (j) => j.preparer, () => 1);
    const rows = sod.map((j) => ({
      ...j,
      types: j.classes.join(', '),
      reason: [...new Set(j.flags.filter((f) => f.rule === 'sod').map((f) => f.reason))].join(' '),
    }));
    return {
      first: { title: '# of flagged JEs', value: count(sod.length), sub: `of ${count(jes.length)} JEs` },
      second: { title: 'Flagged amount', value: pesoShort(sod.reduce((s, j) => s + j.amount, 0)), sub: '' },
      third: { title: 'Preparers involved', value: count(Object.keys(byPrep).length), sub: '' },
      body: (
        <>
          <Panel title="Number of flagged JEs by accounting month" note="Rule 5: the preparer isn't on the roster, posts outside their allowed account types, or rarely posts.">
            <ColumnChart data={months.map((m) => ({ label: monthLabel(m), value: byMonth[m] || 0 }))} format={count} integer emptyText="No segregation-of-duties flags." />
          </Panel>
          <Panel title="Number of flagged JEs by preparer">
            <BarList rows={Object.entries(byPrep).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} format={count} emptyText="No segregation-of-duties flags." />
          </Panel>
          <Panel title="Memo with debits">
            <DataTable columns={[...memoColumns.slice(0, 5), { key: 'types', label: 'Account types' }, { key: 'reason', label: 'Why flagged', wrap: true }, memoColumns[5]]} rows={rows} emptyText="No segregation-of-duties flags." />
          </Panel>
        </>
      ),
      summary: { flagged_jes: sod.length, total_jes: jes.length, flagged_by_preparer: byPrep },
    };
  }

  function cutoff() {
    if (!hasEffective) return notApplicable('Cutoff needs an Effective Date column in the uploaded file.');
    const withDates = jes.filter((j) => j.effective);
    const kind = (j) => {
      if (j.entryDate.slice(0, 4) !== j.effective.slice(0, 4)) return 'Crossed year';
      if (quarterOf(j.entryDate) !== quarterOf(j.effective)) return 'Crossed quarter';
      if (j.entryDate.slice(0, 7) !== j.effective.slice(0, 7)) return 'Crossed month';
      return 'Same period';
    };
    const cats = ['Same period', 'Crossed year', 'Crossed quarter', 'Crossed month'];
    const byKind = sumBy(withDates, kind, () => 1);
    const crossed = withDates.filter((j) => kind(j) !== 'Same period').map((j) => ({ ...j, kind: kind(j) }))
      .sort((a, b) => Math.abs(b.lag) - Math.abs(a.lag));
    return {
      third: { title: 'Crossed year', value: count(byKind['Crossed year'] || 0), sub: 'posted in a different year' },
      body: (
        <>
          <Panel title="Journal entries that cross periods" note="Compares the posting date with the accounting (effective) date.">
            <ColumnChart data={cats.map((c) => ({ label: c, value: byKind[c] || 0 }))} format={count} integer />
          </Panel>
          <Panel title="Memo with debits (entries that cross a period)">
            <DataTable columns={[...memoColumns.slice(0, 4), { key: 'kind', label: 'Crossed' }, { key: 'lag', label: 'Lag (days)', align: 'right' }, memoColumns[4], memoColumns[5]]} rows={crossed} emptyText="No entries cross a period." />
          </Panel>
        </>
      ),
      summary: { jes_by_period_crossing: byKind },
    };
  }

  function postingLag() {
    if (!hasEffective) return notApplicable('Posting Date Lag needs an Effective Date column in the uploaded file.');
    const withLag = jes.filter((j) => j.lag !== null);
    const buckets = [
      ['Before (<0)', (l) => l < 0], ['Same day', (l) => l === 0], ['1–7', (l) => l >= 1 && l <= 7],
      ['8–30', (l) => l >= 8 && l <= 30], ['31–60', (l) => l >= 31 && l <= 60], ['Over 60', (l) => l > 60],
    ];
    const data = buckets.map(([label, test]) => {
      const inB = withLag.filter((j) => test(j.lag));
      return { label, value: inB.length, tip: `${count(inB.length)} JEs, ${pesoShort(inB.reduce((s, j) => s + j.amount, 0))}` };
    });
    const avg = withLag.length ? withLag.reduce((s, j) => s + j.lag, 0) / withLag.length : 0;
    const byPrep = sumBy(withLag, (j) => j.preparer, (j) => j.amount);
    return {
      third: { title: 'Average days posting to accounting', value: avg.toFixed(1), sub: `limit in Testing Criteria: ${criteria.max_posting_lag_days} days` },
      body: (
        <>
          <Panel title="Days between posting and accounting dates" note="Positive = posted after the accounting date (late). Negative = posted before it (forward-dated).">
            <ColumnChart data={data} format={count} integer />
          </Panel>
          <Panel title="Amount by preparer">
            <BarList rows={Object.entries(byPrep).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
          </Panel>
          <Panel title="Memo with debits (longest lag first)">
            <DataTable columns={[...memoColumns.slice(0, 4), { key: 'lag', label: 'Lag (days)', align: 'right' }, memoColumns[4], memoColumns[5]]}
              rows={[...withLag].sort((a, b) => Math.abs(b.lag) - Math.abs(a.lag))} />
          </Panel>
        </>
      ),
      summary: { jes_by_lag_bucket: Object.fromEntries(data.map((d) => [d.label, d.value])), average_lag_days: Number(avg.toFixed(1)), limit_days: criteria.max_posting_lag_days },
    };
  }

  function activityMap() {
    const low = threshold * 0.8;
    const under = jes.filter((j) => j.amount >= low && j.amount < threshold).sort((a, b) => b.amount - a.amount);
    const dayMonth = sumBy(jes, (j) => `${Number(j.entryDate.slice(8, 10))}|${j.entryDate.slice(0, 7)}`, (j) => j.amount);
    const postMonths = monthRange([...new Set(jes.map((j) => j.entryDate.slice(0, 7)))]);
    const days = [...new Set(jes.map((j) => Number(j.entryDate.slice(8, 10))))].sort((a, b) => a - b);
    const lines = jes.flatMap((j) => j.lines);
    const accounts = [...new Set(lines.map((l) => l.account))].sort();
    const accDebit = sumBy(lines, (l) => l.account, (l) => Number(l.debit || 0));
    const accCredit = sumBy(lines, (l) => l.account, (l) => Number(l.credit || 0));
    return {
      third: { title: 'JEs just under the threshold', value: count(under.length), sub: `${pesoShort(low)} to ${pesoShort(threshold)}` },
      extraLeft: (
        <div style={{ background: 'white', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13 }}>
          <label>
            Threshold (₱)
            <input type="number" min="0" step="10000" value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 0)}
              style={{ width: '100%', padding: 6, boxSizing: 'border-box', marginTop: 4 }} />
          </label>
          <input type="range" min="10000" max={Math.max(1000000, threshold)} step="10000" value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: '100%', marginTop: 8 }} />
          <p style={{ color: '#666', margin: '6px 0 0' }}>Shows JEs between 80% and 100% of this amount, e.g. just under an approval limit.</p>
        </div>
      ),
      body: (
        <>
          <Panel title="JE amounts just under the threshold" note="Each bar is one JE. Orange = posted on a weekend or holiday.">
            <Legend items={[{ label: 'Weekday', color: BLUE }, { label: 'Weekend or holiday', color: ORANGE }]} />
            <ColumnChart data={under.map((j) => ({ label: j.key, value: j.amount, color: j.weekend || j.holiday ? ORANGE : BLUE, tip: `${peso(j.amount)} · ${j.entryDate} · ${j.preparer}` }))}
              emptyText="No JEs just under this threshold." />
          </Panel>
          <Panel title="Activity map: amount by day of the month and posting month">
            <HeatTable rowHeader="Day" rowLabels={days.map(String)} colLabels={postMonths.map(monthLabel)}
              value={(r, c) => dayMonth[`${r}|${postMonths[postMonths.map(monthLabel).indexOf(c)]}`]} />
          </Panel>
          <Panel title="Activity map: ledger accounts">
            <DataTable columns={[{ key: 'account', label: 'Account' }, { key: 'type', label: 'Type' }, { key: 'debit', label: 'Debit', align: 'right', format: peso }, { key: 'credit', label: 'Credit', align: 'right', format: peso }]}
              rows={accounts.map((a) => ({ account: a, type: classifyAccount(lines.find((l) => l.account === a)), debit: accDebit[a] || 0, credit: accCredit[a] || 0 }))} />
          </Panel>
          <Panel title="Memo with debits (just under the threshold)"><DataTable columns={memoColumns} rows={under} emptyText="No JEs just under this threshold." /></Panel>
        </>
      ),
      summary: { threshold, jes_between_80_and_100_percent: under.length, those_on_weekend_or_holiday: under.filter((j) => j.weekend || j.holiday).length, top_days_by_amount: Object.entries(dayMonth).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `day ${k.split('|')[0]} of ${monthLabel(k.split('|')[1])}: ${Math.round(v)}`) },
    };
  }

  function duplicates() {
    // Arch's rule: same preparer, same amount, different accounting dates.
    const groups = {};
    jes.forEach((j) => { (groups[`${j.preparer}|${j.amount.toFixed(2)}`] = groups[`${j.preparer}|${j.amount.toFixed(2)}`] || []).push(j); });
    const dupes = Object.values(groups)
      .filter((g) => g.length > 1 && new Set(g.map((j) => j.acctDate)).size > 1)
      .map((g) => ({
        preparer: g[0].preparer,
        amount: g[0].amount,
        jeCount: g.length,
        dates: new Set(g.map((j) => j.acctDate)).size,
        weekendPct: g.filter((j) => j.weekend || j.holiday).length / g.length,
        jes: g,
      }))
      .sort((a, b) => b.amount - a.amount);
    const detail = dupes.flatMap((d) => d.jes);
    return {
      third: { title: 'Possible duplicate groups', value: count(dupes.length), sub: `${count(detail.length)} JEs` },
      body: (
        <>
          <Panel title="Potential duplicate JEs" note="Different JEs by the same preparer for the same amount on different accounting dates.">
            <DataTable
              columns={[{ key: 'preparer', label: 'Prepared by' }, { key: 'amount', label: 'Amount', align: 'right', format: peso },
                { key: 'jeCount', label: '# of JEs', align: 'right' }, { key: 'dates', label: '# of different dates', align: 'right' },
                { key: 'weekendPct', label: '% on weekend/holiday', align: 'right', format: pct }]}
              rows={dupes} emptyText="No possible duplicates." />
          </Panel>
          <Panel title="Journal entry summary"><DataTable columns={memoColumns} rows={detail} emptyText="No possible duplicates." /></Panel>
        </>
      ),
      summary: { duplicate_groups: dupes.slice(0, 15).map((d) => ({ preparer: d.preparer, amount: d.amount, jes: d.jeCount, dates: d.dates })) },
    };
  }

  function weekend() {
    const off = jes.filter((j) => j.weekend || j.holiday);
    const offAmount = off.reduce((s, j) => s + j.amount, 0);
    const byDay = sumBy(jes, (j) => j.weekday, (j) => j.amount);
    const share = (items, keyFn) => {
      const tot = sumBy(items, keyFn, (j) => j.amount);
      const offs = sumBy(items.filter((j) => j.weekend || j.holiday), keyFn, (j) => j.amount);
      return Object.keys(tot).map((k) => ({ label: k, value: offs[k] ? offs[k] / tot[k] : 0, color: ORANGE }))
        .filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    };
    const accountLines = jes.flatMap((j) => j.lines.map((l) => ({ ...j, account: l.account, amount: Number(l.debit || 0) + Number(l.credit || 0) })));
    return {
      third: { title: 'Percent of total on weekend/holiday', value: pct(total ? offAmount / total : 0), sub: `${count(off.length)} JEs` },
      body: (
        <>
          <Panel title="Amount by day of week posted" note="Orange = weekend.">
            <ColumnChart data={WEEK_ORDER.map((d) => ({ label: DAYS[d], value: byDay[d] || 0, color: d === 0 || d === 6 ? ORANGE : BLUE }))} />
          </Panel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <Panel title="Percent on weekend/holiday by account">
              <BarList rows={share(accountLines, (j) => j.account)} format={pct} max={1} emptyText="No weekend or holiday entries." />
            </Panel>
            <Panel title="Percent on weekend/holiday by preparer">
              <BarList rows={share(jes, (j) => j.preparer)} format={pct} max={1} emptyText="No weekend or holiday entries." />
            </Panel>
          </div>
          <Panel title="Memo with debits (weekend and holiday entries)">
            <DataTable columns={[...memoColumns.slice(0, 3), { key: 'dayName', label: 'Day' }, ...memoColumns.slice(3)]}
              rows={off.map((j) => ({ ...j, dayName: j.holiday ? `${DAYS[j.weekday]} (${j.holiday})` : DAYS[j.weekday] }))} emptyText="No weekend or holiday entries." />
          </Panel>
        </>
      ),
      summary: { amount_by_weekday: Object.fromEntries(WEEK_ORDER.map((d) => [DAYS[d], Math.round(byDay[d] || 0)])), weekend_or_holiday_share: Number((total ? offAmount / total : 0).toFixed(3)), holidays_hit: [...new Set(off.map((j) => j.holiday).filter(Boolean))] },
    };
  }

  function flagsAndReview() {
    const lines = jes.flatMap((j) => j.lines);
    const flagged = jes.filter((j) => j.flags.length > 0);
    const byRule = {};
    flagged.forEach((j) => j.rules.forEach((r) => { byRule[r] = (byRule[r] || 0) + 1; }));
    const flaggedLines = lines.filter((l) => l.flags.length > 0);
    const decisions = { 'Not reviewed': 0, Explained: 0, Error: 0, Escalate: 0 };
    flagged.forEach((j) => {
      const d = j.lines.map((l) => reviews[l.id]?.disposition).find(Boolean);
      decisions[d || 'Not reviewed'] += 1;
    });
    const reviewed = flagged.length - decisions['Not reviewed'];
    const adjByStatus = sumBy(adjustments, (a) => a.status, () => 1);
    return {
      first: { title: '# of flagged JEs', value: count(flagged.length), sub: `of ${count(jes.length)} JEs` },
      second: { title: 'Reviewed', value: flagged.length ? pct(reviewed / flagged.length) : '–', sub: `${count(reviewed)} of ${count(flagged.length)}` },
      third: { title: 'Adjusting entries', value: count(adjustments.length), sub: Object.entries(adjByStatus).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') },
      body: (
        <>
          <Panel title="Flagged JEs by rule" note={`${count(flaggedLines.length)} lines are flagged. One JE can hit more than one rule.`}>
            <BarList rows={RULE_ORDER.map((r, i) => ({ label: `${i + 1}. ${RULE_LABELS[r]}`, value: byRule[r] || 0 }))} format={count} />
          </Panel>
          <Panel title="Auditors' decisions on flagged JEs">
            <BarList rows={Object.entries(decisions).map(([label, value]) => ({ label, value }))} format={count} />
          </Panel>
          <Panel title="Flagged JEs, most rules hit first">
            <DataTable
              columns={[memoColumns[0], memoColumns[1], memoColumns[2], memoColumns[4],
                { key: 'ruleNames', label: 'Rules hit', wrap: true }, { key: 'decision', label: 'Decision' }, memoColumns[5]]}
              rows={[...flagged].sort((a, b) => b.rules.length - a.rules.length || b.amount - a.amount).map((j) => ({
                ...j,
                ruleNames: j.rules.map((r) => RULE_LABELS[r] || r).join(', '),
                decision: j.lines.map((l) => reviews[l.id]?.disposition).find(Boolean) || 'Not reviewed',
              }))}
              emptyText="No flags under the current testing criteria." />
          </Panel>
        </>
      ),
      summary: { flagged_jes_by_rule: Object.fromEntries(Object.entries(byRule).map(([r, v]) => [RULE_LABELS[r] || r, v])), decisions, adjusting_entries: adjByStatus },
    };
  }

  function notApplicable(text) {
    return {
      third: { title: 'Not applicable', value: '–', sub: '' },
      body: <Panel title={page}><p style={{ margin: 0 }}>{text}</p></Panel>,
      summary: { not_applicable: text },
    };
  }

  const view = {
    Trending: trending, 'Potential SOD': potentialSOD, Cutoff: cutoff, 'Posting Date Lag': postingLag,
    'Activity Map': activityMap, 'Duplicate JEs': duplicates, 'Weekend JEs': weekend, 'Flags & Review': flagsAndReview,
  }[page]();

  async function askForNote() {
    setAiBusy(true);
    setAiMessage('');
    try {
      const { notes } = await askAI(supabase, 'analytics_note', {
        page_title: page,
        summary: { total_jes: jes.length, total_amount: Math.round(total), filters, ...view.summary },
      });
      setAiNotes({ ...aiNotes, [page]: notes });
    } catch (err) {
      setAiMessage(err.message);
    }
    setAiBusy(false);
  }

  function downloadCSV() {
    const rows = jes.flatMap((j) => j.lines.map((l) => {
      return {
        je_number: j.key,
        posted_date: j.entryDate,
        accounting_date: j.acctDate,
        day_of_week: DAYS[j.weekday],
        weekend_or_holiday: j.weekend || j.holiday ? 'Yes' : 'No',
        holiday: j.holiday || '',
        posting_lag_days: j.lag ?? '',
        account: l.account,
        account_type: classifyAccount(l),
        memo: l.description || '',
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        prepared_by: j.preparer,
        source: j.source,
        je_rules_hit: j.rules.map((r) => RULE_LABELS[r] || r).join(' | '),
        line_flag_reasons: [...new Set(l.flags.map((f) => f.reason))].join(' | '),
        decision: reviews[l.id]?.disposition || '',
        decision_comment: reviews[l.id]?.comment || '',
      };
    }));
    const blob = new Blob([`﻿${toCSV(rows)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `odyssey-${(engagement?.client_name || 'engagement').replace(/[^a-z0-9]+/gi, '-')}-journal-entries.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const filterBox = (key, label, values, format = (v) => v) => (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, fontWeight: 600, color: 'white', gap: 4, minWidth: 130, flex: 1 }}>
      {label}
      <select value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} style={{ padding: 4, fontWeight: 400 }}>
        <option value={ALL}>{ALL}</option>
        {values.map((v) => <option key={v} value={v}>{format(v)}</option>)}
      </select>
    </label>
  );

  const first = view.first || { title: '# of JEs', value: count(jes.length), sub: `${count(jes.reduce((s, j) => s + j.lines.length, 0))} lines` };
  const second = view.second || { title: 'Total amount', value: pesoShort(total), sub: 'sum of debits' };
  const filtered = Object.values(filters).some((v) => v !== ALL);

  return (
    <div style={{ padding: 24, maxWidth: 1250, margin: '0 auto' }}>
      <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>

      {entries.length === 0 ? (
        <p>No journal entries yet. Upload JE data first.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Page list, like Power BI's "Pages" pane */}
          <div style={{ background: 'white', borderRadius: 6, padding: 8, position: 'sticky', top: 12 }}>
            <div style={{ fontWeight: 600, padding: '4px 8px 8px' }}>Pages</div>
            {PAGES.map((p) => (
              <button key={p} onClick={() => { setPage(p); setAiMessage(''); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 8px', border: 'none', cursor: 'pointer', borderRadius: 4,
                  background: page === p ? '#e8eefb' : 'transparent', borderLeft: page === p ? '3px solid #1f4fa3' : '3px solid transparent', fontSize: 14 }}>
                {p}
              </button>
            ))}
            <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '8px 0' }} />
            <button onClick={downloadCSV} style={{ width: '100%', padding: '7px 8px', cursor: 'pointer', fontSize: 13 }}>
              Download CSV
            </button>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ background: '#1f4fa3', color: 'white', borderRadius: '6px 6px 0 0', padding: '10px 14px' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Journal Entries · {page}</div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{engagement?.client_name} — {engagement?.engagement_name}</div>
            </div>
            <div style={{ background: '#1d2531', padding: '10px 14px', borderRadius: '0 0 6px 6px', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {filterBox('source', 'Source', options.source)}
              {filterBox('day', 'Posted day of week', WEEK_ORDER.map((d) => DAYS[d]))}
              {filterBox('preparer', 'Prepared by', options.preparer)}
              {filterBox('month', 'Accounting month', options.month, monthLabel)}
              {filterBox('accountType', 'Account type', options.accountType)}
              {filtered && (
                <button onClick={() => setFilters({ source: ALL, day: ALL, preparer: ALL, month: ALL, accountType: ALL })}
                  style={{ alignSelf: 'flex-end', padding: '4px 10px', cursor: 'pointer' }}>Clear</button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 210px) 1fr', gap: 16, alignItems: 'start' }}>
              <div>
                <Tile {...first} />
                <Tile {...second} />
                <Tile {...view.third} />
                {view.extraLeft}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ background: 'white', borderRadius: 6, padding: 12, marginBottom: 16 }}>
                  {aiNotes[page] ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                      {aiNotes[page].map((n, i) => <li key={i} style={{ marginBottom: 4 }}><ClaudeTag />{n}</li>)}
                    </ul>
                  ) : (
                    <button onClick={askForNote} disabled={aiBusy}
                      style={{ padding: '7px 14px', background: '#3b4cca', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                      <BusyLabel busy={aiBusy} busyText="Claude is reading this page…">Ask Claude what stands out on this page</BusyLabel>
                    </button>
                  )}
                  {aiMessage && <p style={{ color: '#a70', margin: '6px 0 0' }}>{aiMessage}</p>}
                  {aiNotes[page] && (
                    <p style={{ fontSize: 12, color: '#666', margin: '6px 0 0' }}>
                      Claude only sees this page&apos;s totals, not the client&apos;s file. Check anything it points out before relying on it.{' '}
                      <button onClick={askForNote} disabled={aiBusy} style={{ background: 'none', border: 'none', color: '#3b4cca', cursor: 'pointer', padding: 0 }}>Ask again</button>
                    </p>
                  )}
                </div>
                {view.body}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
