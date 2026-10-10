'use client';

// The review panel under each flagged line on the Run JE Testing page:
// 1. the AI's explanation (if asked for),
// 2. the auditor's decision and comment (the AI can draft the comment),
// 3. for an Error, the proposed adjusting entry for the client.
// The AI never saves anything here: every Save button is the person's.

import { useEffect, useState } from 'react';
import { createClient } from '../lib/supabaseClient';
import { askAI } from '../lib/ai';
import { BusyLabel, ClaudeTag } from './ui';

const DECISIONS = {
  Explained: 'Explained (valid)',
  Error: 'Error (needs adjusting)',
  Escalate: 'Escalate (possible fraud)',
};
const RISK_COLORS = { High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--success)' };

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FlagReview({ engagementId, entry, entryIds, jeLines, accounts, note, review, adjustment, onReviewSaved, onAdjustmentSaved }) {
  const supabase = createClient();
  const [decision, setDecision] = useState(review?.disposition || '');
  const [comment, setComment] = useState(review?.comment || '');
  const [aiDrafted, setAiDrafted] = useState(review?.ai_drafted || false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(''); // 'save', 'ai' or 'propose' while waiting

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
    setBusy('save');
    // One decision covers every flagged line of the journal entry, so it is
    // saved once per line (the history and analytics count lines).
    const reviewedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('flag_reviews')
      .upsert((entryIds || [entry.id]).map((lineId) => ({
        engagement_id: engagementId,
        journal_entry_id: lineId,
        disposition: decision,
        comment: comment.trim(),
        ai_drafted: aiDrafted,
        reviewed_at: reviewedAt,
      })), { onConflict: 'engagement_id,journal_entry_id' })
      .select();
    setBusy('');
    if (error) { setMessage(`Error: ${error.message}`); return; }
    setMessage('Decision saved.');
    onReviewSaved(data);
  }

  async function draftAdjustmentWithAI() {
    setBusy('ai');
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
    setBusy('');
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
    setBusy('propose');
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
    setBusy('');
    if (error) { setMessage(`Error: ${error.message}`); return; }
    setAdjOpen(false);
    setMessage('Adjusting entry proposed. The client sees it with the report.');
    onAdjustmentSaved(data);
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 14 }}>
      {note && (
        <p style={{ margin: '0 0 12px' }}>
          <ClaudeTag />
          <strong style={{ color: RISK_COLORS[note.risk] }}>{note.risk} risk.</strong> {note.explanation}
        </p>
      )}

      <div className="row">
        <label htmlFor={`decision-${entry.id}`} style={{ margin: 0 }}>Decision</label>
        <select id={`decision-${entry.id}`} value={decision} onChange={(e) => { setDecision(e.target.value); setMessage(''); }} style={{ width: 'auto', minWidth: 220 }}>
          <option value="">Your decision...</option>
          {Object.entries(DECISIONS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {note && (
          <button onClick={() => { setComment(note.draft_comment); setAiDrafted(true); }} className="btn btn-ai btn-sm">
            Use Claude&apos;s draft comment
          </button>
        )}
        {review && <span className="badge badge-success">Saved: {DECISIONS[review.disposition]}</span>}
      </div>
      <label htmlFor={`comment-${entry.id}`} style={{ marginTop: 12 }}>Comment</label>
      <textarea
        id={`comment-${entry.id}`}
        value={comment}
        onChange={(e) => { setComment(e.target.value); setMessage(''); }}
        rows={2}
        placeholder="What you checked and what you found (needed to save)"
        style={{ minHeight: 72 }}
      />
      {aiDrafted && <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}><ClaudeTag text="Claude draft" />Edit it so it says what you found.</p>}
      <button onClick={saveReview} disabled={!!busy} className="btn btn-sm" style={{ marginTop: 12 }}>
        <BusyLabel busy={busy === 'save'} busyText="Saving…">Save decision</BusyLabel>
      </button>

      {review?.disposition === 'Error' && (
        <div style={{ marginTop: 16, background: 'var(--surface-2)', padding: 16, borderRadius: 'var(--radius-sm)' }}>
          <strong>Proposed adjusting entry</strong>
          {adjustment ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '0 0 6px' }}>{adjustment.description} · <strong>{adjustment.status}</strong>
                {adjustment.client_comment ? ` · client: "${adjustment.client_comment}"` : ''}</p>
              {adjustment.lines.map((l, i) => (
                <div key={i} className="text-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  {l.debit > 0 ? `Dr ${l.account} ${peso(l.debit)}` : `    Cr ${l.account} ${peso(l.credit)}`}
                </div>
              ))}
            </div>
          ) : !adjOpen ? (
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={draftAdjustmentWithAI} disabled={!!busy} className="btn btn-ai btn-sm">
                <BusyLabel busy={busy === 'ai'} busyText="Claude is drafting…">Draft it with Claude</BusyLabel>
              </button>
              <button onClick={writeAdjustmentMyself} disabled={!!busy} className="btn btn-secondary btn-sm">Write it myself</button>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {adjByAI && <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}><ClaudeTag text="Claude draft" />Check every line before proposing it.</p>}
              <label htmlFor={`adj-desc-${entry.id}`}>Description</label>
              <input
                id={`adj-desc-${entry.id}`}
                value={adjDescription}
                onChange={(e) => setAdjDescription(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              <datalist id={`accounts-${entry.id}`}>
                {accounts.map((a) => <option key={a} value={a} />)}
              </datalist>
              <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr><th>Account title</th><th className="num" style={{ width: 150 }}>Debit</th><th className="num" style={{ width: 150 }}>Credit</th><th style={{ width: 48 }}><span style={{ position: 'absolute', left: -9999 }}>Remove</span></th></tr>
                </thead>
                <tbody>
                  {adjLines.map((l, i) => (
                    <tr key={i}>
                      <td><input list={`accounts-${entry.id}`} value={l.account} onChange={(e) => setLine(i, 'account', e.target.value)} /></td>
                      <td><input type="number" min="0" step="0.01" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                      <td><input type="number" min="0" step="0.01" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                      <td><button onClick={() => setAdjLines(adjLines.filter((_, j) => j !== i))} className="btn btn-ghost btn-sm">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={() => setAdjLines([...adjLines, { account: '', debit: 0, credit: 0 }])} className="btn btn-secondary btn-sm">Add line</button>
                <span className={`small ${balanced ? 'text-success' : 'text-danger'}`}>
                  Debits {peso(totalDebit / 100)} · Credits {peso(totalCredit / 100)}
                  {balanced ? ' · balanced' : ' · each line needs an account and a debit OR a credit, and totals must match'}
                </span>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button onClick={proposeAdjustment} disabled={!!busy || !balanced || !adjDescription.trim()} className="btn btn-sm">
                  <BusyLabel busy={busy === 'propose'} busyText="Proposing…">Propose to client</BusyLabel>
                </button>
                <button onClick={() => setAdjOpen(false)} className="btn btn-secondary btn-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && <p className={`alert ${message.startsWith('Error') ? 'alert-danger' : message.includes('saved') || message.includes('proposed') ? 'alert-success' : 'alert-warning'}`} style={{ margin: '12px 0 0' }}>{message}</p>}
    </div>
  );
}
