// The 5 JE testing rules, straight from ODYSSEY's Scope section:
// (1) unusual account combinations, (2) off-hours postings,
// (3) round-dollar amounts, (4) direct general ledger entries,
// (5) late-period adjustments.
//
// This is a pure function: given entries + criteria, it returns which
// entries are flagged and why. No database or React code in here, which
// makes it easy to test on its own and reuse in the "Run" page.

/**
 * @param {Array} entries - rows from the journal_entries table
 * @param {Object} criteria - a row from testing_criteria
 * @returns {Array} entries, each with an added `flags` array: [{ rule, reason }]
 */
export function runJETests(entries, criteria) {
  if (!entries || entries.length === 0) return [];

  // --- Precompute things needed across multiple rules ---

  // Rule 5 (unusual accounts): count how many times each account appears
  // in this batch. An account used only once is treated as "unusual" —
  // a simple frequency-based proxy since we don't have historical data
  // from prior periods to compare against yet.
  const accountCounts = {};
  entries.forEach((e) => {
    accountCounts[e.account] = (accountCounts[e.account] || 0) + 1;
  });

  // Rule 4 (late-period): we don't have a separate "period end date" field,
  // so we treat the latest entry_date in this batch as the period end.
  // Entries within `late_period_days` of that date are flagged.
  const latestDate = entries.reduce((max, e) => {
    const d = new Date(e.entry_date);
    return d > max ? d : max;
  }, new Date(0));

  return entries.map((entry) => {
    const flags = [];
    const amount = entry.debit > 0 ? entry.debit : entry.credit;

    // --- Rule 1: Round-dollar amounts ---
    if (amount > 0 && criteria.round_dollar_threshold > 0 && amount % criteria.round_dollar_threshold === 0) {
      flags.push({
        rule: 'round_dollar',
        reason: `Amount (₱${amount.toLocaleString()}) is an exact multiple of the ₱${criteria.round_dollar_threshold.toLocaleString()} threshold.`,
      });
    }

    // --- Rule 2: Off-hours postings (only if we have a time value) ---
    if (entry.entry_time) {
      const [hour, minute] = entry.entry_time.split(':').map(Number);
      const entryMinutes = hour * 60 + minute;
      const [startH, startM] = criteria.off_hours_start.split(':').map(Number);
      const [endH, endM] = criteria.off_hours_end.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      // Off-hours window usually wraps past midnight (e.g. 19:00 to 06:00),
      // so we check both sides of that wraparound.
      const isOffHours = startMinutes > endMinutes
        ? (entryMinutes >= startMinutes || entryMinutes <= endMinutes)
        : (entryMinutes >= startMinutes && entryMinutes <= endMinutes);

      if (isOffHours) {
        flags.push({
          rule: 'off_hours',
          reason: `Posted at ${entry.entry_time}, within the off-hours window (${criteria.off_hours_start}–${criteria.off_hours_end}).`,
        });
      }
    }

    // --- Rule 3: Direct general ledger entries ---
    // MVP heuristic: flag if explicitly marked is_direct_gl, OR the
    // description mentions "direct"/"general ledger" as a stand-in until
    // entries can be tagged at upload time or linked to a sub-ledger source.
    if (criteria.flag_direct_gl) {
      const desc = (entry.description || '').toLowerCase();
      if (entry.is_direct_gl || desc.includes('direct') || desc.includes('general ledger')) {
        flags.push({
          rule: 'direct_gl',
          reason: entry.is_direct_gl
            ? 'Entry is marked as a direct general ledger posting.'
            : 'Description suggests a direct general ledger posting (keyword match).',
        });
      }
    }

    // --- Rule 4: Late-period adjustments ---
    const entryDate = new Date(entry.entry_date);
    const daysBeforePeriodEnd = Math.round((latestDate - entryDate) / (1000 * 60 * 60 * 24));
    if (daysBeforePeriodEnd >= 0 && daysBeforePeriodEnd <= criteria.late_period_days) {
      flags.push({
        rule: 'late_period',
        reason: `Posted ${daysBeforePeriodEnd} day(s) before period end (within the ${criteria.late_period_days}-day window).`,
      });
    }

    // --- Rule 5: Unusual account combinations ---
    if (criteria.flag_unusual_accounts && accountCounts[entry.account] === 1) {
      flags.push({
        rule: 'unusual_account',
        reason: `"${entry.account}" appears only once in this batch — an unusually infrequent account for this engagement.`,
      });
    }

    return { ...entry, flags };
  });
}

// Human-readable labels for displaying rule names in the UI.
export const RULE_LABELS = {
  round_dollar: 'Round-Dollar Amount',
  off_hours: 'Off-Hours Posting',
  direct_gl: 'Direct GL Entry',
  late_period: 'Late-Period Adjustment',
  unusual_account: 'Unusual Account',
};
