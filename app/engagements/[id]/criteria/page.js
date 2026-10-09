'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { DEFAULT_CRITERIA } from '../../../../lib/jeTesting';
import { BackLink, BusyLabel, Spinner } from '../../../../components/ui';

const sectionStyle = { borderTop: '1px solid #eee', paddingTop: 16 };
const hintStyle = { margin: '4px 0 8px', color: '#666', fontSize: 14 };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 };

// One rule: a title with an on/off checkbox, a short explanation, and its settings.
function Rule({ number, title, field, criteria, updateField, hint, children }) {
  return (
    <div style={sectionStyle}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'bold' }}>
        <input type="checkbox" checked={!!criteria[field]} onChange={(e) => updateField(field, e.target.checked)} />
        {number}. {title}
      </label>
      <p style={hintStyle}>{hint}</p>
      {criteria[field] && children}
    </div>
  );
}

function NumberInput({ field, criteria, updateField, width = 100, step = 'any' }) {
  return (
    <input
      type="number"
      min="0"
      step={step}
      value={criteria[field] ?? ''}
      onChange={(e) => updateField(field, e.target.value === '' ? null : Number(e.target.value))}
      style={{ padding: 8, width }}
    />
  );
}

export default function TestingCriteria({ params }) {
  const { id: engagementId } = params;
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [holidayCount, setHolidayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { data } = await supabase
        .from('testing_criteria')
        .select('*')
        .eq('engagement_id', engagementId)
        .single();

      if (data) {
        // Keep only the settings this page edits; fall back to the default
        // for any column that is still empty.
        const merged = { ...DEFAULT_CRITERIA };
        Object.keys(DEFAULT_CRITERIA).forEach((key) => {
          if (data[key] !== null && data[key] !== undefined) merged[key] = data[key];
        });
        setCriteria(merged);
      }

      const { count } = await supabase.from('holidays').select('*', { count: 'exact', head: true });
      setHolidayCount(count || 0);
      setLoading(false);
    }
    load();
  }, [engagementId]);

  function updateField(field, value) {
    setCriteria((prev) => ({ ...prev, [field]: value }));
    setSavedMessage('');
  }

  // Clearly trivial threshold = about 5% of overall materiality (PSA 320 practice).
  function applyFivePercent() {
    if (!(criteria.materiality > 0)) return;
    updateField('round_min_amount', Math.round(criteria.materiality * 0.05));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    // upsert = insert if no row exists yet for this engagement, otherwise update.
    // This works because engagement_id has a UNIQUE constraint in the schema.
    const { error } = await supabase
      .from('testing_criteria')
      .upsert(
        {
          engagement_id: engagementId,
          ...criteria,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'engagement_id' }
      );

    if (error) {
      setSavedMessage(`Error: ${error.message}`);
    } else {
      setSavedMessage('Testing criteria saved.');
    }
    setSaving(false);
  }

  if (loading) return <p style={{ padding: 24, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading…</p>;

  const ruleProps = { criteria, updateField };

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
      <h1>Configure Testing Criteria</h1>
      <p style={{ color: '#666' }}>These 7 rules decide which journal entries get flagged for this engagement. Uncheck a rule to skip it.</p>

      <form onSubmit={handleSave} style={{ background: 'white', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>

        <Rule number={1} title="Off-Hours Posting" field="flag_off_hours" {...ruleProps}
          hint={`Flag entries keyed in on a weekend or a Philippine holiday. ${holidayCount} holidays are in the Holiday Calendar.`}>
          <label style={rowStyle}>
            <input type="checkbox" checked={!!criteria.flag_weekends} onChange={(e) => updateField('flag_weekends', e.target.checked)} />
            Flag weekends too (uncheck for clients that normally work weekends, like retail)
          </label>
        </Rule>

        <Rule number={2} title="Posting Lag" field="flag_posting_lag" {...ruleProps}
          hint="Flag entries keyed in too long after their effective date, or before it. Needs an Effective Date column.">
          <div style={rowStyle}>
            <span>Maximum lag:</span>
            <NumberInput field="max_posting_lag_days" step="1" {...ruleProps} />
            <span>days (60 allows two monthly closes)</span>
          </div>
        </Rule>

        <Rule number={3} title="Round-Peso Amounts" field="flag_round" {...ruleProps}
          hint="Flag round amounts at or above the clearly trivial threshold, which is about 5% of materiality.">
          <div style={rowStyle}>
            <span>Overall materiality: ₱</span>
            <NumberInput field="materiality" width={160} {...ruleProps} />
            <button type="button" onClick={applyFivePercent} style={{ padding: '6px 10px', cursor: 'pointer' }}>Use 5% as threshold</button>
          </div>
          <div style={rowStyle}>
            <span>Flag amounts at or above: ₱</span>
            <NumberInput field="round_min_amount" width={160} {...ruleProps} />
          </div>
          <div style={rowStyle}>
            <span>&quot;Round&quot; means an exact multiple of: ₱</span>
            <NumberInput field="round_multiple" width={120} {...ruleProps} />
          </div>
        </Rule>

        <Rule number={4} title="Late-Period Adjustments" field="flag_late_period" {...ruleProps}
          hint="Flag entries in the last days before and the first days after the period end. Entries keyed in after the period end but dated before it are marked post-closing (higher risk).">
          <div style={rowStyle}>
            <span>Period end (MM-DD):</span>
            <input type="text" value={criteria.period_end || ''} onChange={(e) => updateField('period_end', e.target.value)} style={{ padding: 8, width: 80 }} placeholder="12-31" />
          </div>
          <div style={rowStyle}>
            <NumberInput field="late_days_before" step="1" width={70} {...ruleProps} />
            <span>days before and</span>
            <NumberInput field="late_days_after" step="1" width={70} {...ruleProps} />
            <span>days after (calendar days)</span>
          </div>
        </Rule>

        <Rule number={5} title="Segregation of Duties" field="flag_sod" {...ruleProps}
          hint="Flag entries posted by someone outside their assigned accounts. Needs a Prepared By column.">
          <p style={{ ...hintStyle, marginTop: 0 }}>
            Client&apos;s preparer list, one person per line, as <code>Name: allowed accounts or types</code>.
            Example: <code>Ana Cruz: Expense, Liability</code>
          </p>
          <textarea
            rows={4}
            value={criteria.preparer_roster || ''}
            onChange={(e) => updateField('preparer_roster', e.target.value)}
            style={{ padding: 8, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
          <div style={rowStyle}>
            <span>If the list is empty, flag preparers posting under</span>
            <NumberInput field="sod_rare_pct" width={70} {...ruleProps} />
            <span>% of entries</span>
          </div>
        </Rule>

        <Rule number={6} title="Unusual Account Combinations" field="flag_unusual_accounts" {...ruleProps}
          hint="Flag debit/credit account-type pairs that are always suspicious (like Debit Revenue / Credit Expense), or that this client rarely uses.">
          <div style={rowStyle}>
            <span>Rare = used fewer than</span>
            <NumberInput field="combo_min_count" step="1" width={70} {...ruleProps} />
            <span>times, or in under</span>
            <NumberInput field="combo_rare_pct" width={70} {...ruleProps} />
            <span>% of journal entries</span>
          </div>
        </Rule>

        <Rule number={7} title="Manual / Direct GL Entries" field="flag_direct_gl" {...ruleProps}
          hint="Low priority. For Xero / QuickBooks clients only: flag entries whose Source column says they were keyed in by hand.">
          <div style={rowStyle}>
            <span>Source words that mean manual:</span>
            <input type="text" value={criteria.manual_source_keywords || ''} onChange={(e) => updateField('manual_source_keywords', e.target.value)} style={{ padding: 8, flex: 1, minWidth: 200 }} />
          </div>
        </Rule>

        {savedMessage && (
          <p style={{ color: savedMessage.startsWith('Error') ? 'crimson' : '#2a7' }}>{savedMessage}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          style={{ padding: '10px 20px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          <BusyLabel busy={saving} busyText="Saving…">Save Criteria</BusyLabel>
        </button>
      </form>
    </div>
  );
}
