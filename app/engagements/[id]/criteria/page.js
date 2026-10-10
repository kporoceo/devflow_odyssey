'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { DEFAULT_CRITERIA } from '../../../../lib/jeTesting';
import { BackLink, BusyLabel, Spinner } from '../../../../components/ui';

const sectionStyle = { borderTop: '1px solid var(--border)', paddingTop: 20 };
const hintStyle = { margin: '4px 0 12px', color: 'var(--text-2)', fontSize: 14 };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10, fontSize: 14, fontWeight: 400, color: 'var(--text)' };

// One rule: a title with an on/off checkbox, a short explanation, and its settings.
function Rule({ number, title, field, criteria, updateField, hint, children }) {
  return (
    <div style={sectionStyle}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 15, color: 'var(--text)', margin: 0 }}>
        <input type="checkbox" checked={!!criteria[field]} onChange={(e) => updateField(field, e.target.checked)} />
        {number}. {title}
      </label>
      <p style={hintStyle}>{hint}</p>
      {criteria[field] && children}
    </div>
  );
}

// Peso amounts with thousands commas (1,000,000). Only digits and one dot are
// kept, so the saved value is still a plain number.
function withCommas(text) {
  const [whole, ...rest] = String(text).replace(/[^0-9.]/g, '').split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest.length ? `${grouped}.${rest.join('').slice(0, 2)}` : grouped;
}

function PesoInput({ field, criteria, updateField, width = 160 }) {
  const value = criteria[field];
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value === null || value === undefined ? '' : withCommas(value)}
      onChange={(e) => {
        const text = withCommas(e.target.value);
        updateField(field, text === '' ? null : (text.endsWith('.') ? text.replace(/,/g, '') : Number(text.replace(/,/g, ''))));
      }}
      style={{ width, textAlign: 'right' }}
    />
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
      style={{ width }}
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

  if (loading) return <p className="loading"><Spinner /> Loading…</p>;

  const ruleProps = { criteria, updateField };

  return (
    <div className="page page-narrow">
      <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configure Testing Criteria</h1>
          <p className="page-subtitle">These 7 rules decide which journal entries get flagged for this engagement. Uncheck a rule to skip it.</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="card stack-lg">

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
            <PesoInput field="materiality" width={160} {...ruleProps} />
            <button type="button" onClick={applyFivePercent} className="btn btn-secondary btn-sm">Use 5% as threshold</button>
          </div>
          <div style={rowStyle}>
            <span>Flag amounts at or above: ₱</span>
            <PesoInput field="round_min_amount" width={160} {...ruleProps} />
          </div>
          <div style={rowStyle}>
            <span>&quot;Round&quot; means an exact multiple of: ₱</span>
            <PesoInput field="round_multiple" width={120} {...ruleProps} />
          </div>
        </Rule>

        <Rule number={4} title="Late-Period Adjustments" field="flag_late_period" {...ruleProps}
          hint="Flag entries in the last days before and the first days after the period end. Entries keyed in after the period end but dated before it are marked post-closing (higher risk).">
          <div style={rowStyle}>
            <span>Period end (MM-DD):</span>
            <input type="text" value={criteria.period_end || ''} onChange={(e) => updateField('period_end', e.target.value)} style={{ width: 90 }} placeholder="12-31" />
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
            style={{ marginBottom: 12 }}
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
            <input type="text" value={criteria.manual_source_keywords || ''} onChange={(e) => updateField('manual_source_keywords', e.target.value)} style={{ flex: 1, minWidth: 200, width: 'auto' }} />
          </div>
        </Rule>

        {savedMessage && (
          <p className={`alert ${savedMessage.startsWith('Error') ? 'alert-danger' : 'alert-success'}`} style={{ margin: 0 }}>{savedMessage}</p>
        )}

        <div className="form-actions" style={{ marginTop: 0 }}>
          <button type="submit" disabled={saving} className="btn">
            <BusyLabel busy={saving} busyText="Saving…">Save Criteria</BusyLabel>
          </button>
        </div>
      </form>
    </div>
  );
}
