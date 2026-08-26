'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';

const DEFAULTS = {
  round_dollar_threshold: 1000,
  off_hours_start: '19:00',
  off_hours_end: '06:00',
  late_period_days: 5,
  flag_direct_gl: true,
  flag_unusual_accounts: true,
};

export default function TestingCriteria({ params }) {
  const { id: engagementId } = params;
  const [criteria, setCriteria] = useState(DEFAULTS);
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
        setCriteria({
          round_dollar_threshold: data.round_dollar_threshold,
          off_hours_start: data.off_hours_start?.slice(0, 5) || DEFAULTS.off_hours_start,
          off_hours_end: data.off_hours_end?.slice(0, 5) || DEFAULTS.off_hours_end,
          late_period_days: data.late_period_days,
          flag_direct_gl: data.flag_direct_gl,
          flag_unusual_accounts: data.flag_unusual_accounts,
        });
      }
      setLoading(false);
    }
    load();
  }, [engagementId]);

  function updateField(field, value) {
    setCriteria((prev) => ({ ...prev, [field]: value }));
    setSavedMessage('');
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

  if (loading) return <p style={{ padding: 24 }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <Link href={`/engagements/${engagementId}`} style={{ display: 'inline-block', marginBottom: 16 }}>
        &larr; Back to Engagement
      </Link>
      <h1>Configure Testing Criteria</h1>
      <p style={{ color: '#666' }}>These thresholds control how the JE testing engine flags entries for this engagement.</p>

      <form onSubmit={handleSave} style={{ background: 'white', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>1. Round-Dollar Amounts</label>
          <p style={{ margin: '0 0 8px', color: '#666', fontSize: 14 }}>Flag entries that are an exact multiple of this amount.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>₱</span>
            <input
              type="number"
              min="1"
              value={criteria.round_dollar_threshold}
              onChange={(e) => updateField('round_dollar_threshold', parseFloat(e.target.value))}
              style={{ padding: 8, width: 150 }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>2. Off-Hours Postings</label>
          <p style={{ margin: '0 0 8px', color: '#666', fontSize: 14 }}>Flag entries posted between these times.</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input type="time" value={criteria.off_hours_start} onChange={(e) => updateField('off_hours_start', e.target.value)} style={{ padding: 8 }} />
            <span>to</span>
            <input type="time" value={criteria.off_hours_end} onChange={(e) => updateField('off_hours_end', e.target.value)} style={{ padding: 8 }} />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 4 }}>3. Late-Period Adjustments</label>
          <p style={{ margin: '0 0 8px', color: '#666', fontSize: 14 }}>Flag entries posted within this many days of period-end.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min="0"
              value={criteria.late_period_days}
              onChange={(e) => updateField('late_period_days', parseInt(e.target.value, 10))}
              style={{ padding: 8, width: 100 }}
            />
            <span>days</span>
          </div>
        </div>

        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'bold' }}>
            <input
              type="checkbox"
              checked={criteria.flag_direct_gl}
              onChange={(e) => updateField('flag_direct_gl', e.target.checked)}
            />
            4. Flag Direct General Ledger Entries
          </label>
        </div>

        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'bold' }}>
            <input
              type="checkbox"
              checked={criteria.flag_unusual_accounts}
              onChange={(e) => updateField('flag_unusual_accounts', e.target.checked)}
            />
            5. Flag Unusual Account Combinations
          </label>
        </div>

        {savedMessage && (
          <p style={{ color: savedMessage.startsWith('Error') ? 'crimson' : '#2a7' }}>{savedMessage}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          style={{ padding: '10px 20px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          {saving ? 'Saving...' : 'Save Criteria'}
        </button>
      </form>
    </div>
  );
}
