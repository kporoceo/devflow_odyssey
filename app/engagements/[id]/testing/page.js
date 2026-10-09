'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { runJETests, getRuleStatus, RULE_LABELS, DEFAULT_CRITERIA } from '../../../../lib/jeTesting';

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
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { data: entryData } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('engagement_id', engagementId)
        .order('created_at', { ascending: true })
        .order('line_no', { ascending: true });

      const { data: criteriaData } = await supabase
        .from('testing_criteria')
        .select('*')
        .eq('engagement_id', engagementId)
        .single();

      const { data: holidayData } = await supabase
        .from('holidays')
        .select('holiday_date, name');

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

    if (flagRows.length > 0) {
      const { error: flagError } = await supabase.from('je_test_flags').insert(flagRows);
      if (flagError) {
        setSaveMessage(`Results saved, but flags failed: ${flagError.message}`);
        return;
      }
    }

    setSaveMessage(`Saved: ${flaggedEntries.length} of ${results.length} entries flagged.`);
  }

  if (loading) return <p style={{ padding: 24 }}>Loading...</p>;

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
      <Link href={`/engagements/${engagementId}`} style={{ display: 'inline-block', marginBottom: 16 }}>
        &larr; Back to Engagement
      </Link>
      <h1>Run JE Testing</h1>
      <p style={{ color: '#666' }}>
        {entries.length} journal entry lines loaded for this engagement.
      </p>

      {entries.length === 0 && (
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
          {running ? 'Running...' : 'Run JE Testing'}
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
                style={{ padding: '8px 16px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Save Results
              </button>
            </div>
          </div>

          <div style={{ background: 'white', padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <strong>Rules</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
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

          {flagged.length === 0 ? (
            <p style={{ color: '#666' }}>No entries were flagged under the current testing criteria.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sortedFlagged.map((entry) => (
                <div key={entry.id} style={{ background: 'white', padding: 16, borderRadius: 8, borderLeft: '4px solid crimson' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{entry.je_number ? `JE ${entry.je_number} · ` : ''}{entry.account}</strong>
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
