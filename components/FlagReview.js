'use client';

// The review panel under each flagged line on the Run JE Testing page:
// 1. the AI's explanation (if asked for),
// 2. the auditor's decision and comment (the AI can draft the comment),
// 3. for an Error, the proposed adjusting entry for the client.
// The AI never saves anything here: every Save button is the person's.

import { useEffect, useState } from 'react';
import { createClient } from '../lib/supabaseClient';
import { askAI, AI_BADGE_STYLE } from '../lib/ai';

const DECISIONS = {
  Explained: 'Explained (valid)',
  Error: 'Error (needs adjusting)',
  Escalate: 'Escalate (possible fraud)',
};
const RISK_COLORS = { High: 'crimson', Medium: '#c60', Low: '#2a7' };

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FlagReview({ engagementId, entry, jeLines, accounts, note, review, adjustment, onReviewSaved, onAdjustmentSaved }) {
  const supabase = createClient();
  const [decision, setDecision] = useState(review?.disposition || '');
  const [comment, setComment] = useState(review?.comment || '');
  const [aiDrafted, setAiDrafted] = useState(review?.ai_drafted || false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Adjusting entry editor (only for decision = Error)
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjDescription, setAdjDescription] = useState('');
  const [adjLines, setAdjLines] = useState([]);
  const [adjByAI, setAdjByAI] = useState(false);

  useEffect(() => {
    setDecision(review?.disposition || '');
    setComment(review?.comment || '');
    setAiDrafted(review?.ai_drafted || false);
  }, [review?.id]);

  async function saveReview() {
    if (!decision) { setMessage('Pick a decision.'); return; }
    if (!comment.trim()) { setMessage('Write a comment. It goes in the working papers.'); return; }
    setBusy(true);
    const { data, error } = await supabase
      .from('flag_reviews')
      .upsert({
        engagement_id: engagementId,
        journal_entry_id: entry.id,
        disposition: decision,
        comment: comment.trim(),
        ai_drafted: aiDrafted,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: 'engagement_id,journal_entry_id' })
      .select()
      .single();
    setBusy(false);
    if (error) { setMessage(`Error: ${error.message}`); return; }
    setMessage('Decision saved.');
    onReviewSaved(data);
  }

  async function draftAdjustmentWithAI() {
    setBusy(true);
    setMessage('');
    try {
      const result = await askAI(supabase, 'draft_adjustment', { entry, je_lines: jeLines, comment, accounts });
      setAdjDescription(result.description);
      setAdjLines(result.lines);
      setAdjByAI(true);
      setAdjOpen(true);
    } catch (err) {
      setMessage(err.message);
    }
    setBusy(false);
  }

  function writeAdjustmentMyself() {
    setAdjDescription('To correct ');
    setAdjLines([{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }]);
    setAdjByAI(false);
    setAdjOpen(true);
  }

  function setLine(i, field, value) {
    setAdjLines(adjLines.map((l, j) => (j === i ? { ...l, [field]: value } : l)));
  }

  const totalDebit = adjLines.reduce((s, l) => s + toCents(l.debit), 0);
  const totalCredit = adjLines.reduce((s, l) => s + toCents(l.credit), 0);
  const balanced = adjLines.length >= 2 && totalDebit === totalCredit && totalDebit > 0
    && adjLines.every((l) => l.account.trim() && (toCents(l.debit) > 0) !== (toCents(l.credit) > 0));

  async function proposeAdjustment() {
    if (!adjDescription.trim() || !balanced) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('adjusting_entries')
      .insert({
        engagement_id: engagementId,
        journal_entry_id: entry.id,
        description: adjDescription.trim(),
        lines: adjLines.map((l) => ({ account: l.account.trim(), debit: toCents(l.debit) / 100, credit: toCents(l.credit) / 100 })),
        ai_drafted: adjByAI,
      })
      .select()
      .single();
    setBusy(false);
    if (error) { setMessage(`Error: ${error.message}`); return; }
    setAdjOpen(false);
    setMessage('Adjusting entry proposed. The client sees it with the report.');
    onAdjustmentSaved(data);
  }

  const small = { padding: '6px 12px', cursor: 'pointer' };
  const aiButton = { ...small, background: '#3b4cca', color: 'white', border: 'none', borderRadius: 4 };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #ddd', fontSize: 14 }}>
      {note && (
        <p style={{ margin: '0 0 8px' }}>
          <span style={AI_BADGE_STYLE}>AI</span>
          <strong style={{ color: RISK_COLORS[note.risk] }}>{note.risk} risk.</strong> {note.explanation}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={decision} onChange={(e) => { setDecision(e.target.value); setMessage(''); }} style={{ padding: 6 }}>
          <option value="">Your decision...</option>
          {Object.entries(DECISIONS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {note && (
          <button onClick={() => { setComment(note.draft_comment); setAiDrafted(true); }} style={small}>
            Use AI draft comment
          </button>
        )}
        {review && <span style={{ color: '#2a7' }}>Saved: {DECISIONS[review.disposition]}</span>}
      </div>
      <textarea
        value={comment}
        onChange={(e) => { setComment(e.target.value); setMessage(''); }}
        rows={2}
        placeholder="Your comment (required)"
        style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: 8, fontFamily: 'inherit' }}
      />
      {aiDrafted && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#666' }}><span style={AI_BADGE_STYLE}>AI draft</span>Edit it so it says what you found.</p>}
      <button onClick={saveReview} disabled={busy} style={{ ...small, marginTop: 8, background: '#111', color: 'white', border: 'none', borderRadius: 4 }}>
        Save decision
      </button>

      {review?.disposition === 'Error' && (
        <div style={{ marginTop: 12, background: '#fafafa', padding: 12, borderRadius: 6 }}>
          <strong>Proposed adjusting entry</strong>
          {adjustment ? (
            <div style={{ marginTop: 6 }}>
              <p style={{ margin: '0 0 4px' }}>{adjustment.description} · <strong>{adjustment.status}</strong>
                {adjustment.client_comment ? ` · client: "${adjustment.client_comment}"` : ''}</p>
              {adjustment.lines.map((l, i) => (
                <div key={i} style={{ color: '#555' }}>
                  {l.debit > 0 ? `Dr ${l.account} ${peso(l.debit)}` : `    Cr ${l.account} ${peso(l.credit)}`}
                </div>
              ))}
            </div>
          ) : !adjOpen ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button onClick={draftAdjustmentWithAI} disabled={busy} style={aiButton}>{busy ? 'Asking AI...' : 'Draft it with AI'}</button>
              <button onClick={writeAdjustmentMyself} disabled={busy} style={small}>Write it myself</button>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {adjByAI && <p style={{ margin: '0 0 6px', fontSize: 12, color: '#666' }}><span style={AI_BADGE_STYLE}>AI draft</span>Check every line before proposing it.</p>}
              <input
                value={adjDescription}
                onChange={(e) => setAdjDescription(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: 6, marginBottom: 6 }}
              />
              <datalist id={`accounts-${entry.id}`}>
                {accounts.map((a) => <option key={a} value={a} />)}
              </datalist>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#666', textAlign: 'left' }}><th>Account</th><th>Debit</th><th>Credit</th><th /></tr>
                </thead>
                <tbody>
                  {adjLines.map((l, i) => (
                    <tr key={i}>
                      <td><input list={`accounts-${entry.id}`} value={l.account} onChange={(e) => setLine(i, 'account', e.target.value)} style={{ width: '100%', padding: 4, boxSizing: 'border-box' }} /></td>
                      <td><input type="number" min="0" step="0.01" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} style={{ width: 110, padding: 4 }} /></td>
                      <td><input type="number" min="0" step="0.01" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} style={{ width: 110, padding: 4 }} /></td>
                      <td><button onClick={() => setAdjLines(adjLines.filter((_, j) => j !== i))} style={{ cursor: 'pointer' }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <button onClick={() => setAdjLines([...adjLines, { account: '', debit: 0, credit: 0 }])} style={small}>Add line</button>
                <span style={{ color: balanced ? '#2a7' : 'crimson' }}>
                  Debits {peso(totalDebit / 100)} · Credits {peso(totalCredit / 100)}
                  {balanced ? ' · balanced' : ' · each line needs an account and a debit OR a credit, and totals must match'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={proposeAdjustment} disabled={busy || !balanced || !adjDescription.trim()} style={{ ...small, background: '#111', color: 'white', border: 'none', borderRadius: 4 }}>
                  Propose to client
                </button>
                <button onClick={() => setAdjOpen(false)} style={small}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && <p style={{ margin: '6px 0 0', color: message.startsWith('Error') ? 'crimson' : message.includes('saved') || message.includes('proposed') ? '#2a7' : '#a70' }}>{message}</p>}
    </div>
  );
}
