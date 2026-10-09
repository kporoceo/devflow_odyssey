'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../../lib/supabaseClient';
import { useProfile } from '../../../components/AppShell';
import { canPrepareReports, isClient, signoffStepFor } from '../../../lib/roles';
import { RULE_LABELS } from '../../../lib/jeTesting';
import { askAI } from '../../../lib/ai';
import { BackLink, BusyLabel, ClaudeTag, Spinner } from '../../../components/ui';
import { fetchAll } from '../../../lib/fetchAll';

// Report status colours, from app/globals.css.
const STATUS_BADGE = {
  'Draft': 'badge',
  'Returned': 'badge badge-danger',
  'For Review': 'badge badge-warning',
  'For Partner Approval': 'badge badge-warning',
  'For Client Approval': 'badge badge-warning',
  'Signed Off': 'badge badge-success',
};

export default function ReportDetail({ params }) {
  const { id } = params;
  const { profile } = useProfile();
  const [report, setReport] = useState(null);
  const [signoffs, setSignoffs] = useState([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [signedName, setSignedName] = useState('');
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(''); // which action is running: 'save', 'ai', 'sign', 'adj'
  const [signMessage, setSignMessage] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [adjustments, setAdjustments] = useState([]);
  const [adjComments, setAdjComments] = useState({});
  const [aiDrafted, setAiDrafted] = useState(false);
  const supabase = createClient();

  async function load() {
    const { data, error } = await supabase
      .from('reports')
      .select('*, engagements(client_name, engagement_name)')
      .eq('id', id)
      .single();
    if (error || !data) {
      setNotFound(true);
      return;
    }
    setReport(data);
    setTitle(data.title);
    setBody(data.body || '');

    const { data: rows } = await supabase
      .from('report_signoffs')
      .select('*')
      .eq('report_id', id)
      .order('signed_at', { ascending: true });
    setSignoffs(rows || []);

    const { data: adj } = await supabase
      .from('adjusting_entries')
      .select('*')
      .eq('engagement_id', data.engagement_id)
      .order('proposed_at', { ascending: true });
    setAdjustments(adj || []);
  }

  useEffect(() => { load(); }, [id]);
  useEffect(() => { if (profile) setSignedName(profile.full_name || ''); }, [profile]);

  if (notFound) {
    return (
      <div className="page page-narrow">
        <div className="card">
          <p>This report doesn&apos;t exist or isn&apos;t shared with you.</p>
          <Link href="/reports">&larr; Back to reports</Link>
        </div>
      </div>
    );
  }
  if (!report || !profile) return <p className="loading"><Spinner /> Loading…</p>;

  const editable = canPrepareReports(profile.role) && ['Draft', 'Returned'].includes(report.status);
  const step = signoffStepFor(report.status);
  const myTurn = step && step.canAct(profile.role);

  async function handleSave() {
    setBusy('save');
    const { error } = await supabase
      .from('reports')
      .update({ title: title.trim(), body, updated_at: new Date().toISOString() })
      .eq('id', id);
    setBusy('');
    setMessage(error ? `Error: ${error.message}` : 'Draft saved.');
  }

  // Adds a summary of the engagement's latest saved JE testing run to the report text.
  async function insertTestingSummary() {
    const { data: run } = await supabase
      .from('je_test_results')
      .select('id, run_at, total_entries, flagged_count')
      .eq('engagement_id', report.engagement_id)
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!run) {
      setMessage('No saved JE testing run for this engagement yet.');
      return;
    }
    const { data: flags } = await fetchAll(() => supabase.from('je_test_flags').select('id, rule').eq('test_result_id', run.id).order('id'));
    const byRule = {};
    (flags || []).forEach((f) => { byRule[f.rule] = (byRule[f.rule] || 0) + 1; });
    const lines = Object.entries(byRule).map(([rule, n]) => `- ${RULE_LABELS[rule] || rule}: ${n} flag(s)`);
    const summary = [
      `JE testing results (run on ${new Date(run.run_at).toLocaleDateString('en-PH', { dateStyle: 'long' })})`,
      `${run.flagged_count} of ${run.total_entries} journal entry lines were flagged for review.`,
      ...lines,
    ].join('\n');
    setBody((prev) => (prev ? `${prev}\n\n${summary}` : summary));
    setMessage('Summary added. Remember to save the draft.');
  }

  // The AI drafts the findings from the saved run, the auditors' decisions
  // and the adjusting entries. It's added to the text box for the preparer to edit.
  async function draftFindingsWithAI() {
    setBusy('ai');
    setMessage('');
    try {
      const { text } = await askAI(supabase, 'draft_findings', { engagement_id: report.engagement_id });
      setBody((prev) => (prev ? `${prev}\n\n${text}` : text));
      setAiDrafted(true);
      setMessage('AI draft added. Read and edit it, then save the draft.');
    } catch (err) {
      setMessage(err.message);
    }
    setBusy('');
  }

  // Client: accept or reject a proposed adjusting entry.
  async function decideAdjustment(adjId, decision) {
    if (decision === 'Rejected' && !(adjComments[adjId] || '').trim()) {
      setMessage('Error: add a comment saying why you are rejecting this adjusting entry.');
      return;
    }
    setBusy(`adj-${adjId}-${decision}`);
    setMessage('');
    const { error } = await supabase.rpc('decide_adjustment', {
      p_id: adjId,
      p_decision: decision,
      p_comment: adjComments[adjId] || '',
    });
    setBusy('');
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setMessage(`Adjusting entry ${decision.toLowerCase()}.`);
    load();
  }

  async function sign(decision) {
    if (decision === 'Returned' && !comment.trim()) {
      setSignMessage('Error: write a comment saying what needs fixing, then click Return.');
      return;
    }
    setSignMessage('');
    if (editable) await handleSave();
    setBusy(`sign-${decision}`);
    const { error } = await supabase.rpc('sign_report', {
      p_report_id: id,
      p_decision: decision,
      p_signed_name: signedName,
      p_comment: comment,
    });
    setBusy('');
    if (error) {
      setSignMessage(`Error: ${error.message}`);
      return;
    }
    setComment('');
    setSignMessage(decision === 'Returned'
      ? 'Returned to the preparer with your comment. It will come back through the sign-off from the start.'
      : decision === 'Submitted' ? 'Submitted for review.' : 'Signed.');
    // A client can't see a returned report any more, so update it here instead of reloading.
    if (isClient(profile.role) && decision === 'Returned') {
      setReport({ ...report, status: 'Returned' });
      return;
    }
    load();
  }

  return (
    <div className="page page-narrow">
      <BackLink href="/reports">Back to {isClient(profile.role) ? 'My Reports' : 'Reports'}</BackLink>

      <div className="page-header" style={{ display: 'block' }}>
        <p className="text-2" style={{ margin: '0 0 8px', fontSize: 14 }}>{report.engagements?.client_name} — {report.engagements?.engagement_name}</p>
        {editable ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }} />
        ) : (
          <h1 className="page-title" style={{ marginBottom: 12 }}>{report.title}</h1>
        )}
        <div className="row" style={{ gap: 8 }}>
          <span className={STATUS_BADGE[report.status] || 'badge'}>{report.status}</span>
          {report.status === 'Signed Off' && <span className="muted small"> · locked, no further changes</span>}
        </div>
      </div>

      <div className="stack-lg">
        <div className="card">
          {editable ? (
            <>
              <textarea
                value={body}
                onChange={(e) => { setBody(e.target.value); setMessage(''); }}
                rows={14}
                placeholder="Write the report here."
                style={{ fontSize: 15 }}
              />
              <div className="form-actions" style={{ marginTop: 16 }}>
                <button onClick={handleSave} disabled={!!busy} className="btn">
                  <BusyLabel busy={busy === 'save'} busyText="Saving…">Save draft</BusyLabel>
                </button>
                <button onClick={insertTestingSummary} disabled={!!busy} className="btn btn-secondary">Add JE testing summary</button>
                <button onClick={draftFindingsWithAI} disabled={!!busy} className="btn btn-ai">
                  <BusyLabel busy={busy === 'ai'} busyText="Claude is drafting…">Draft findings with Claude</BusyLabel>
                </button>
              </div>
              {busy === 'ai' && <p className="hint" style={{ marginBottom: 0 }}>This can take up to a minute.</p>}
              {aiDrafted && <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}><ClaudeTag text="Claude draft" />Claude only used this engagement&apos;s saved results. You&apos;re responsible for the final wording.</p>}
            </>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{report.body || <span className="muted">(No content yet.)</span>}</div>
          )}
        </div>

        {message && <div className={message.startsWith('Error') ? 'alert alert-danger' : 'alert alert-success'}>{message}</div>}

        {adjustments.length > 0 && (
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: 12 }}>Proposed adjusting entries</h2>
            {isClient(profile.role) && adjustments.some((a) => a.status === 'Proposed') && (
              <p className="card-subtitle">
                These are corrections the auditors propose to your books. <strong>Accept</strong> one if you agree to record it.
                <strong> Reject</strong> it if you don&apos;t, and say why. A rejected entry stays on record as an unadjusted
                difference, which the partner considers when forming the audit opinion. Decide every entry before you approve the report.
              </p>
            )}
            {adjustments.map((a) => (
              <div key={a.id} style={{ borderTop: '1px solid var(--border)', padding: '16px 0' }}>
                <p style={{ margin: '0 0 6px' }}>
                  <strong>{a.description}</strong>{' '}
                  <span className={a.status === 'Accepted' ? 'text-success' : a.status === 'Rejected' ? 'text-danger' : 'text-warning'}>· {a.status}</span>
                </p>
                {a.journal_entry_id && !isClient(profile.role) && (
                  <p style={{ margin: '0 0 8px', fontSize: 14 }}>
                    <Link href={`/engagements/${report.engagement_id}/entries/${a.journal_entry_id}`}>View the flagged journal entry →</Link>
                  </p>
                )}
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="compact">
                    <thead>
                      <tr>
                        <th>Account title</th>
                        <th className="num">Debit (₱)</th>
                        <th className="num">Credit (₱)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.lines.map((l, i) => (
                        <tr key={i}>
                          <td style={l.credit > 0 ? { paddingLeft: 34 } : undefined}>{l.account}</td>
                          <td className="num">{l.debit > 0 ? Number(l.debit).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : ''}</td>
                          <td className="num">{l.credit > 0 ? Number(l.credit).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {a.client_comment && <p className="text-2" style={{ margin: '8px 0 0', fontSize: 14 }}>Client comment: {a.client_comment}</p>}
                {isClient(profile.role) && a.status === 'Proposed' && report.status === 'For Client Approval' && (
                  <div style={{ marginTop: 12 }}>
                    <input
                      value={adjComments[a.id] || ''}
                      onChange={(e) => setAdjComments({ ...adjComments, [a.id]: e.target.value })}
                      placeholder="Your comment (needed if you reject)"
                      style={{ marginBottom: 10 }}
                    />
                    <div className="row" style={{ gap: 8 }}>
                      <button onClick={() => decideAdjustment(a.id, 'Accepted')} disabled={!!busy} className="btn btn-success">
                        <BusyLabel busy={busy === `adj-${a.id}-Accepted`} busyText="Saving…">Accept</BusyLabel>
                      </button>
                      <button onClick={() => decideAdjustment(a.id, 'Rejected')} disabled={!!busy || !(adjComments[a.id] || '').trim()} title={(adjComments[a.id] || '').trim() ? '' : 'Write a comment first'} className="btn btn-danger-outline">
                        <BusyLabel busy={busy === `adj-${a.id}-Rejected`} busyText="Saving…">Reject</BusyLabel>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {step && (
          <div className="card card-accent">
            <h2 className="card-title" style={{ marginBottom: 8 }}>Sign-off</h2>
            {!myTurn ? (
              <p className="text-2" style={{ margin: 0 }}>Waiting for: {step.who}.</p>
            ) : (
              <>
                <p className="card-subtitle" style={{ marginBottom: 20 }}>
                  {step.level === 'Preparer'
                    ? 'When the draft is ready, submit it to the Audit and Assurance Lead for review.'
                    : step.level === 'Client'
                      ? 'Approve to accept this report and sign it off. Return it if something needs to change; the firm will revise it and send it back to you.'
                      : 'Approve to pass it to the next level, or return it with a comment saying what needs fixing.'}
                </p>
                <label className="field">
                  Type your full name as your signature
                  <input value={signedName} onChange={(e) => setSignedName(e.target.value)} style={{ marginTop: 6, fontWeight: 400 }} />
                </label>
                {step.level !== 'Preparer' && (
                  <label className="field">
                    Comment
                    <textarea value={comment} onChange={(e) => { setComment(e.target.value); setSignMessage(''); }} rows={3} placeholder="Needed if you return the report: say what needs fixing." style={{ marginTop: 6, fontWeight: 400 }} />
                  </label>
                )}
                <div className="form-actions">
                  {step.level === 'Preparer' ? (
                    <button onClick={() => sign('Submitted')} disabled={!!busy} className="btn">
                      <BusyLabel busy={busy === 'sign-Submitted'} busyText="Submitting…">Submit for review</BusyLabel>
                    </button>
                  ) : (
                    <>
                      <button onClick={() => sign('Approved')} disabled={!!busy} className="btn">
                        <BusyLabel busy={busy === 'sign-Approved'} busyText="Signing…">Approve and sign</BusyLabel>
                      </button>
                      <button onClick={() => sign('Returned')} disabled={!!busy || !comment.trim()} title={comment.trim() ? '' : 'Write a comment first'} className="btn btn-danger-outline">
                        <BusyLabel busy={busy === 'sign-Returned'} busyText="Returning…">Return to preparer</BusyLabel>
                      </button>
                    </>
                  )}
                </div>
                {step.level !== 'Preparer' && (
                  <p className="hint" style={{ margin: '12px 0 0' }}>
                    Return sends the report back to the preparer as <strong>Returned</strong> with your comment. They revise it and submit it again, and it goes through every sign-off level from the start.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {signMessage && (
          <div className={signMessage.startsWith('Error') ? 'alert alert-danger' : 'alert alert-success'}>{signMessage}</div>
        )}

        <div className="card">
          <h2 className="card-title" style={{ marginBottom: 16 }}>Sign-off history</h2>
          {signoffs.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No sign-offs yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Decision</th>
                    <th>Signed by</th>
                    <th>Date and time</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {signoffs.map((s) => (
                    <tr key={s.id}>
                      <td>{s.level}</td>
                      <td className={s.decision === 'Returned' ? 'text-danger' : 'text-success'}>{s.decision}</td>
                      <td>{s.signed_name}</td>
                      <td className="muted">{new Date(s.signed_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="text-2">{s.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
