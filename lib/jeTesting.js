// The 7 JE testing rules for finals (Kathryn, 2026-10-08):
// (1) off-hours posting (weekends + holidays), (2) posting lag
// (entry date vs effective date), (3) round-peso amounts, (4) late-period
// adjustments, (5) segregation of duties, (6) unusual account
// combinations, (7) manual / direct GL entries.
//
// This is a pure function: given entries + criteria + holidays, it returns
// which entries are flagged and why. No database or React code in here,
// which makes it easy to test on its own and reuse in the "Run" page.
//
// No machine learning anywhere: every flag comes from a rule an auditor
// can read and explain to the client.

const DAY = 1000 * 60 * 60 * 24;

// Fallback settings, used when an engagement never saved its criteria.
export const DEFAULT_CRITERIA = {
  flag_off_hours: true,
  flag_weekends: true,
  flag_posting_lag: true,
  max_posting_lag_days: 60,
  flag_round: true,
  materiality: null,
  round_min_amount: 0,
  round_multiple: 1000,
  flag_late_period: true,
  period_end: '12-31',
  late_days_before: 5,
  late_days_after: 5,
  flag_sod: true,
  preparer_roster: '',
  sod_rare_pct: 1,
  flag_unusual_accounts: true,
  combo_min_count: 3,
  combo_rare_pct: 1,
  flag_direct_gl: true,
  manual_source_keywords: 'manual journal, journal entry, general journal',
};

// Rule 6 only compares against the client's own history once there is
// enough of it. Below this many journal entries, only the fixed list runs.
const MIN_JES_FOR_HISTORY = 30;

// Human-readable labels for displaying rule names in the UI.
// The last three are the midterm rule names, kept so old saved runs still display.
export const RULE_LABELS = {
  off_hours: 'Off-Hours Posting',
  posting_lag: 'Posting Lag',
  round_peso: 'Round-Peso Amount',
  late_period: 'Late-Period Adjustment',
  sod: 'Segregation of Duties',
  unusual_combo: 'Unusual Account Combination',
  manual_entry: 'Manual / Direct GL Entry',
  round_dollar: 'Round Amount (midterm rule)',
  direct_gl: 'Direct GL Entry (midterm rule)',
  unusual_account: 'Unusual Account (midterm rule)',
};

export const RULE_ORDER = ['off_hours', 'posting_lag', 'round_peso', 'late_period', 'sod', 'unusual_combo', 'manual_entry'];

// ---------- Small helpers ----------

// "2026-12-31" -> milliseconds at UTC midnight. Using UTC everywhere avoids
// the Philippines' +8 timezone shifting dates by one day.
function toDay(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

function fmtDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function peso(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "a, b\nc" -> ['a', 'b', 'c'] (lowercase, trimmed)
function parseList(text) {
  return String(text || '').split(/[\n,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function amountOf(entry) {
  return Number(entry.debit) > 0 ? Number(entry.debit) : Number(entry.credit);
}

// Account class: use the class from the client's file (or, later, the AI
// classification) when there is one; otherwise guess from the account name.
const CLASSES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense', 'Suspense'];

export function classifyAccount(entry) {
  const given = String(entry.account_class || '').trim().toLowerCase();
  const match = CLASSES.find((c) => c.toLowerCase() === given);
  if (match) return match;

  const name = String(entry.account || '').toLowerCase();
  if (/suspense|clearing/.test(name)) return 'Suspense';
  if (/payable|loan|accrued|unearned|deferred revenue|withholding|borrowing/.test(name)) return 'Liability';
  if (/capital|retained earnings|equity|drawing|dividend|share premium/.test(name)) return 'Equity';
  if (/cash|bank|receivable|inventory|prepaid|equipment|building|land|furniture|vehicle|investment|accumulated depreciation|deposit/.test(name)) return 'Asset';
  if (/expense|cost|income tax/.test(name)) return 'Expense';
  if (/revenue|sales|income|fee earned/.test(name)) return 'Revenue';
  if (/salar|wage|rent|utilit|supplies|depreciation|tax|insurance|repair|advertis|fuel|communication|transport|representation|professional fee|commission|freight/.test(name)) return 'Expense';
  return 'Unclassified';
}

function isFixedAsset(entry) {
  return /equipment|building|land|furniture|vehicle|property|machinery/.test(String(entry.account || '').toLowerCase());
}

function isCashOrReceivable(entry) {
  return /cash|bank|receivable/.test(String(entry.account || '').toLowerCase());
}

// Groups lines into journal entries.
// - If every line has a JE number, group by it.
// - Otherwise, if lines have their upload order (line_no), walk them in
//   order and close a journal entry each time debits = credits.
// - Otherwise grouping isn't possible (returns null).
export function groupJournalEntries(entries) {
  if (entries.every((e) => e.je_number)) {
    const groups = {};
    entries.forEach((e) => {
      (groups[e.je_number] = groups[e.je_number] || []).push(e);
    });
    return Object.values(groups);
  }

  if (entries.every((e) => e.line_no !== null && e.line_no !== undefined)) {
    // Sort by upload time first, so two uploads to the same engagement
    // don't get their rows mixed together.
    const sorted = [...entries].sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.line_no - b.line_no);
    const groups = [];
    let current = [];
    let balance = 0;
    sorted.forEach((e) => {
      current.push(e);
      balance += Math.round((Number(e.debit) - Number(e.credit)) * 100);
      if (balance === 0) {
        groups.push(current);
        current = [];
      }
    });
    if (current.length > 0) groups.push(current);
    return groups;
  }

  return null;
}

// Period ends near a date: this year's and last year's (e.g. Dec 31, 2025
// and Dec 31, 2026 for any 2026 date).
function nearbyPeriodEnds(dayMs, periodEnd) {
  const [mm, dd] = String(periodEnd || '12-31').split('-').map(Number);
  const year = new Date(dayMs).getUTCFullYear();
  return [year - 1, year].map((y) => Date.UTC(y, mm - 1, dd));
}

// ---------- Which rules can run on this data ----------

// Returns one row per rule: { rule, status: 'on' | 'off' | 'na', note }
// 'na' = "Not applicable": the file doesn't have the column the rule needs.
export function getRuleStatus(entries, criteria) {
  const c = { ...DEFAULT_CRITERIA, ...criteria };
  const has = (field) => entries.some((e) => e[field] !== null && e[field] !== undefined && e[field] !== '');
  const groups = groupJournalEntries(entries);
  const preparers = new Set(entries.map((e) => e.entered_by).filter(Boolean));

  const rows = [
    { rule: 'off_hours', on: c.flag_off_hours, na: null },
    { rule: 'posting_lag', on: c.flag_posting_lag, na: has('effective_date') ? null : 'The file has no Effective Date column.' },
    { rule: 'round_peso', on: c.flag_round, na: null },
    { rule: 'late_period', on: c.flag_late_period, na: null },
    { rule: 'sod', on: c.flag_sod, na: has('entered_by') ? null : 'The file has no Prepared By column.' },
    { rule: 'unusual_combo', on: c.flag_unusual_accounts, na: groups ? null : 'Lines can\'t be grouped into journal entries (no JE No. column). Re-upload the file to fix this.' },
    { rule: 'manual_entry', on: c.flag_direct_gl, na: has('source') || entries.some((e) => e.is_direct_gl) ? null : 'The file has no Source column (only Xero / QuickBooks exports have one).' },
  ];

  return rows.map(({ rule, on, na }) => {
    if (!on) return { rule, status: 'off', note: 'Turned off in Testing Criteria.' };
    if (na) return { rule, status: 'na', note: na };

    let note = '';
    if (rule === 'round_peso' && !(Number(c.round_min_amount) > 0)) {
      note = 'No threshold set yet, so every round amount is flagged. Set materiality in Testing Criteria.';
    }
    if (rule === 'sod' && preparers.size === 1) {
      note = 'Only one preparer posts everything. Report this once as a control finding.';
    }
    if (rule === 'sod' && !parseList(c.preparer_roster).length && preparers.size > 1) {
      note = 'No preparer roster yet, so only rarely-posting preparers are flagged.';
    }
    if (rule === 'unusual_combo' && groups && groups.length < MIN_JES_FOR_HISTORY) {
      note = `Only ${groups.length} journal entries, so only the fixed list of suspicious combinations is checked (history check needs ${MIN_JES_FOR_HISTORY}).`;
    }
    return { rule, status: 'on', note };
  });
}

// ---------- The rules ----------

/**
 * @param {Array} entries - rows from the journal_entries table
 * @param {Object} criteria - a row from testing_criteria
 * @param {Object} holidays - { '2026-12-25': 'Christmas Day', ... }
 * @returns {Array} entries, each with an added `flags` array: [{ rule, reason }]
 */
export function runJETests(entries, criteria, holidays = {}) {
  if (!entries || entries.length === 0) return [];

  const c = { ...DEFAULT_CRITERIA, ...criteria };
  const status = {};
  getRuleStatus(entries, c).forEach((s) => { status[s.rule] = s.status; });
  const flagsById = {};
  entries.forEach((e) => { flagsById[e.id] = []; });
  const flag = (entry, rule, reason) => flagsById[entry.id].push({ rule, reason });

  // --- Rule 1: Off-hours posting (weekends + holidays), on the entry date ---
  if (status.off_hours === 'on') {
    entries.forEach((e) => {
      const day = toDay(e.entry_date);
      if (day === null) return;
      const weekday = new Date(day).getUTCDay(); // 0 = Sunday, 6 = Saturday
      const holidayName = holidays[fmtDay(day)];
      if (holidayName) {
        flag(e, 'off_hours', `Entered on ${fmtDay(day)}, a holiday (${holidayName}).`);
      } else if (c.flag_weekends && (weekday === 0 || weekday === 6)) {
        flag(e, 'off_hours', `Entered on a ${weekday === 0 ? 'Sunday' : 'Saturday'} (${fmtDay(day)}).`);
      }
    });
  }

  // --- Rule 2: Posting lag = entry date - effective date ---
  if (status.posting_lag === 'on') {
    entries.forEach((e) => {
      const entered = toDay(e.entry_date);
      const effective = toDay(e.effective_date);
      if (entered === null || effective === null) return;
      const lag = Math.round((entered - effective) / DAY);
      if (lag > c.max_posting_lag_days) {
        flag(e, 'posting_lag', `Entered ${lag} days after its effective date (limit is ${c.max_posting_lag_days}).`);
      } else if (lag < 0) {
        flag(e, 'posting_lag', `Entered ${-lag} day(s) before its effective date (forward-dated).`);
      }
    });
  }

  // --- Rule 3: Round-peso amounts at or above the threshold ---
  if (status.round_peso === 'on' && Number(c.round_multiple) > 0) {
    const multipleCents = Math.round(Number(c.round_multiple) * 100);
    const minAmount = Number(c.round_min_amount) || 0;
    entries.forEach((e) => {
      const amount = amountOf(e);
      if (amount > 0 && amount >= minAmount && Math.round(amount * 100) % multipleCents === 0) {
        flag(e, 'round_peso', minAmount > 0
          ? `${peso(amount)} is a round multiple of ${peso(c.round_multiple)} and at or above the ${peso(minAmount)} threshold.`
          : `${peso(amount)} is a round multiple of ${peso(c.round_multiple)}.`);
      }
    });
  }

  // --- Rule 4: Late-period adjustments around the period end ---
  if (status.late_period === 'on') {
    const before = Number(c.late_days_before);
    const after = Number(c.late_days_after);
    entries.forEach((e) => {
      const entered = toDay(e.entry_date);
      const effective = toDay(e.effective_date);
      const check = [entered, effective].filter((d) => d !== null);
      if (check.length === 0) return;

      for (const end of nearbyPeriodEnds(check[0], c.period_end)) {
        // "5 days before" = the last 5 calendar days including the period end (Dec 27-31).
        // "5 days after" = the first 5 days of the new period (Jan 1-5).
        const inWindow = (d) => d > end - before * DAY && d <= end + after * DAY;
        if (!check.some(inWindow)) continue;

        if (effective !== null && entered !== null && effective <= end && entered > end && entered <= end + after * DAY) {
          flag(e, 'late_period', `Post-closing entry: entered ${fmtDay(entered)}, after the ${fmtDay(end)} period end, but dated ${fmtDay(effective)} in the closed period. Higher risk.`);
        } else {
          const d = check.find(inWindow);
          flag(e, 'late_period', `Dated ${fmtDay(d)}, within ${before} days before or ${after} days after the ${fmtDay(end)} period end.`);
        }
        break;
      }
    });
  }

  // --- Rule 5: Segregation of duties ---
  if (status.sod === 'on') {
    const roster = {};
    String(c.preparer_roster || '').split('\n').forEach((line) => {
      const [name, allowed] = line.split(':');
      if (name && name.trim()) roster[name.trim().toLowerCase()] = parseList(allowed);
    });
    const preparerCounts = {};
    entries.forEach((e) => {
      if (e.entered_by) preparerCounts[e.entered_by] = (preparerCounts[e.entered_by] || 0) + 1;
    });

    entries.forEach((e) => {
      if (!e.entered_by) return;
      const who = String(e.entered_by).trim();

      if (Object.keys(roster).length > 0) {
        const allowed = roster[who.toLowerCase()];
        if (!allowed) {
          flag(e, 'sod', `${who} is not on the client's list of people allowed to post entries.`);
          return;
        }
        const accountClass = classifyAccount(e).toLowerCase();
        const account = String(e.account || '').toLowerCase();
        const ok = allowed.length === 0 || allowed.some((a) => a === accountClass || account.includes(a));
        if (!ok) {
          flag(e, 'sod', `${who} posted to ${e.account} (${classifyAccount(e)}), outside their assigned accounts (${allowed.join(', ')}).`);
        }
      } else if (Object.keys(preparerCounts).length > 1) {
        const share = (preparerCounts[e.entered_by] / entries.length) * 100;
        if (share < Number(c.sod_rare_pct)) {
          flag(e, 'sod', `${who} rarely posts entries (${preparerCounts[e.entered_by]} of ${entries.length} lines, under ${c.sod_rare_pct}%).`);
        }
      }
    });
  }

  // --- Rule 6: Unusual account combinations ---
  if (status.unusual_combo === 'on') {
    const groups = groupJournalEntries(entries);
    const pairKey = (d, cr) => `${classifyAccount(d)} → ${classifyAccount(cr)}`;

    // Count each debit-class → credit-class pair once per journal entry.
    const pairCounts = {};
    groups.forEach((lines) => {
      const seen = new Set();
      lines.filter((l) => Number(l.debit) > 0).forEach((d) => {
        lines.filter((l) => Number(l.credit) > 0).forEach((cr) => seen.add(pairKey(d, cr)));
      });
      seen.forEach((k) => { pairCounts[k] = (pairCounts[k] || 0) + 1; });
    });
    const useHistory = groups.length >= MIN_JES_FOR_HISTORY;

    groups.forEach((lines) => {
      const debits = lines.filter((l) => Number(l.debit) > 0);
      const credits = lines.filter((l) => Number(l.credit) > 0);
      const reasons = [];

      // Fixed list: always suspicious, even for a first-year client.
      lines.forEach((l) => {
        if (classifyAccount(l) === 'Suspense') reasons.push(`Uses a suspense/clearing account (${l.account}).`);
      });
      debits.forEach((d) => {
        credits.forEach((cr) => {
          const dc = classifyAccount(d);
          const cc = classifyAccount(cr);
          if (dc === 'Revenue' && cc === 'Expense') reasons.push(`Debit ${d.account} (Revenue) / Credit ${cr.account} (Expense).`);
          if (dc === 'Equity' && (cc === 'Revenue' || cc === 'Expense')) reasons.push(`Debit ${d.account} (Equity) / Credit ${cr.account} (${cc}).`);
          if (isFixedAsset(d) && cc === 'Expense') reasons.push(`Debit ${d.account} (Fixed Asset) / Credit ${cr.account} (Expense): possible capitalised expense.`);
        });
      });
      const revenueCredit = credits.some((cr) => classifyAccount(cr) === 'Revenue');
      if (revenueCredit && debits.length > 0 && debits.every((d) => classifyAccount(d) === 'Asset' && !isCashOrReceivable(d))) {
        reasons.push('Revenue credited against a non-cash, non-receivable asset.');
      }

      // History: pairs this client rarely uses.
      if (useHistory) {
        const seen = new Set();
        debits.forEach((d) => credits.forEach((cr) => seen.add(pairKey(d, cr))));
        seen.forEach((k) => {
          const count = pairCounts[k];
          const pct = (count / groups.length) * 100;
          if (count < c.combo_min_count || pct < c.combo_rare_pct) {
            reasons.push(`${k} appears in only ${count} of ${groups.length} journal entries.`);
          }
        });
      }

      const unique = [...new Set(reasons)];
      if (unique.length > 0) {
        const label = lines[0].je_number ? `${lines[0].je_number}: ` : '';
        lines.forEach((l) => flag(l, 'unusual_combo', label + unique.join(' ')));
      }
    });
  }

  // --- Rule 7: Manual / direct GL entries (Xero / QuickBooks clients) ---
  if (status.manual_entry === 'on') {
    const keywords = parseList(c.manual_source_keywords);
    entries.forEach((e) => {
      const source = String(e.source || '').toLowerCase();
      if (e.is_direct_gl) {
        flag(e, 'manual_entry', 'Marked as a direct general ledger posting.');
      } else if (source && keywords.some((k) => source.includes(k))) {
        flag(e, 'manual_entry', `Source is "${e.source}", a manual journal rather than a system-generated entry.`);
      }
    });
  }

  return entries.map((entry) => ({ ...entry, flags: flagsById[entry.id] }));
}
