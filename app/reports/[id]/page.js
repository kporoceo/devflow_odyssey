'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../../lib/supabaseClient';
import { useProfile } from '../../../components/AppShell';
import { canPrepareReports, isClient, signoffStepFor, STATUS_COLORS } from '../../../lib/roles';
import { RULE_LABELS } from '../../../lib/jeTesting';
import { askAI, AI_BADGE_STYLE } from '../../../lib/ai';

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
  const [busy, setBusy] = useState(false);
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
      <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
        <p>This report doesn&apos;t exist or isn&apos;t shared with you.</p>
        <Link href="/reports">&larr; Back to reports</Link>
      </div>
    );
  }
  if (!report || !profile) return <p style={{ padding: 24 }}>Loading...</p>;

  const editable = canPrepareReports(profile.role) && ['Draft', 'Returned'].includes(report.status);
  const step = signoffStepFor(report.status);
  const myTurn = step && step.canAct(profile.role);

  async function handleSave() {
    setBusy(true);
    const { error } = await supabase
      .from('reports')
      .update({ title: title.trim(), body, updated_at: new Date().toISOString() })
      .eq('id', id);
    setBusy(false);
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
    const { data: flags } = await supabase.from('je_test_flags').select('rule').eq('test_result_id', run.id);
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
    setBusy(true);
    setMessage('');
    try {
      const { text } = await askAI(supabase, 'draft_findings', { engagement_id: report.engagement_id });
      setBody((prev) => (prev ? `${prev}\n\n${text}` : text));
      setAiDrafted(true);
      setMessage('AI draft added. Read and edit it, then save the draft.');
    } catch (err) {
      setMessage(err.message);
    }
    setBusy(false);
  }

  // Client: accept or reject a proposed adjusting entry.
  async function decideAdjustment(adjId, decision) {
    setBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('decide_adjustment', {
      p_id: adjId,
      p_decision: decision,
      p_comment: adjComments[adjId] || '',
    });
    setBusy(false);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setMessage(`Adjusting entry ${decision.toLowerCase()}.`);
    load();
  }

  async function sign(decision) {
    setBusy(true);
    setMessage('');
    if (editable) await handleSave();
    const { error } = await supabase.rpc('sign_report', {
      p_report_id: id,
      p_decision: decision,
      p_signed_name: signedName,
      p_comment: comment,
    });
    setBusy(false);
    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }
    setComment('');
    setMessage(decision === 'Returned' ? 'Returned with your comment.' : 'Signed.');
    // A client can't see a returned report any more, so update it here instead of reloading.
    if (isClient(profile.role) && decision === 'Returned') {
      setReport({ ...report, status: 'Returned' });
      return;
    }
    load();
  }

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
      <Link href="/reports" style={{ display: 'inline-block', marginBottom: 16 }}>&larr; Back to {isClient(profile.role) ? 'My Reports' : 'Reports'}</Link>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <p style={{ margin: 0, color: '#666' }}>{report.engagements?.client_name} — {report.engagements?.engagement_name}</p>
        {editable ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: 22, fontWeight: 'bold', width: '100%', padding: 6, margin: '8px 0', boxSizing: 'border-box' }} />
        ) : (
          <h1 style={{ margin: '8px 0' }}>{report.title}</h1>
        )}
        <span style={{ color: STATUS_COLORS[report.status], fontWeight: 'bold' }}>{report.status}</span>
        {report.status === 'Signed Off' && <span style={{ color: '#666' }}> · locked, no further changes</span>}
      </div>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        {editable ? (
          <>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setMessage(''); }}
              rows={14}
              placeholder="Write the report here."
              style={{ width: '100%', padding: 10, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 15 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={handleSave} disabled={busy} style={{ padding: '8px 16px', cursor: 'pointer' }}>Save draft</button>
              <button onClick={insertTestingSummary} disabled={busy} style={{ padding: '8px 16px', cursor: 'pointer' }}>Add JE testing summary</button>
              <button onClick={draftFindingsWithAI} disabled={busy} style={{ padding: '8px 16px', cursor: 'pointer', background: '#3b4cca', color: 'white', border: 'none', borderRadius: 4 }}>
                {busy ? 'Working...' : 'Draft findings with AI'}
              </button>
            </div>
            {aiDrafted && <p style={{ fontSize: 12, color: '#666', marginBottom: 0 }}><span style={AI_BADGE_STYLE}>AI draft</span>The AI only uses this engagement&apos;s saved results. You&apos;re responsible for the final wording.</p>}
          </>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{report.body || <span style={{ color: '#666' }}>(No content yet.)</span>}</div>
        )}
      </div>

      {message && <p style={{ color: message.startsWith('Error') ? 'crimson' : '#2a7' }}>{message}</p>}

      {adjustments.length > 0 && (
        <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Proposed adjusting entries</h3>
          {isClient(profile.role) && adjustments.some((a) => a.status === 'Proposed') && (
            <p style={{ color: '#666', marginTop: 0 }}>Accept or reject each one before you approve the report.</p>
          )}
          {adjustments.map((a) => (
            <div key={a.id} style={{ borderTop: '1px solid #eee', padding: '10px 0' }}>
              <p style={{ margin: '0 0 4px' }}>
                <strong>{a.description}</strong>{' '}
                <span style={{ color: a.status === 'Accepted' ? '#2a7' : a.status === 'Rejected' ? 'crimson' : '#c60' }}>· {a.status}</span>
              </p>
              <table style={{ fontSize: 14, borderCollapse: 'collapse' }}>
                <tbody>
                  {a.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: '2px 12px 2px 0', paddingLeft: l.credit > 0 ? 24 : 0 }}>{l.account}</td>
                      <td style={{ padding: '2px 12px', textAlign: 'right' }}>{l.debit > 0 ? Number(l.debit).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : ''}</td>
                      <td style={{ padding: '2px 12px', textAlign: 'right' }}>{l.credit > 0 ? Number(l.credit).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.client_comment && <p style={{ margin: '4px 0 0', color: '#666' }}>Client comment: {a.client_comment}</p>}
              {isClient(profile.role) && a.status === 'Proposed' && report.status === 'For Client Approval' && (
                <div style={{ marginTop: 6 }}>
                  <input
                    value={adjComments[a.id] || ''}
                    onChange={(e) => setAdjComments({ ...adjComments, [a.id]: e.target.value })}
                    placeholder="Comment (required if you reject)"
                    style={{ padding: 6, width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
                  />
                  <button onClick={() => decideAdjustment(a.id, 'Accepted')} disabled={busy} style={{ padding: '6px 14px', background: '#2a7', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', marginRight: 8 }}>Accept</button>
                  <button onClick={() => decideAdjustment(a.id, 'Rejected')} disabled={busy} style={{ padding: '6px 14px', background: 'white', color: 'crimson', border: '1px solid crimson', borderRadius: 4, cursor: 'pointer' }}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {step && (
        <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Sign-off</h3>
          {!myTurn ? (
            <p style={{ color: '#666', margin: 0 }}>Waiting for: {step.who}.</p>
          ) : (
            <>
              <p style={{ color: '#666', marginTop: 0 }}>
                {step.level === 'Preparer'
                  ? 'When the draft is ready, submit it to the Audit and Assurance Lead for review.'
                  : 'Approve to pass it to the next level, or return it with a comment saying what needs fixing.'}
              </p>
              <label style={{ display: 'block', marginBottom: 8 }}>
                Type your full name as your signature
                <input value={signedName} onChange={(e) => setSignedName(e.target.value)} style={{ display: 'block', padding: 8, width: '100%', boxSizing: 'border-box', marginTop: 4 }} />
              </label>
              {step.level !== 'Preparer' && (
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Comment (required when returning)
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} style={{ display: 'block', padding: 8, width: '100%', boxSizing: 'border-box', marginTop: 4, fontFamily: 'inherit' }} />
                </label>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {step.level === 'Preparer' ? (
                  <button onClick={() => sign('Submitted')} disabled={busy} style={{ padding: '10px 20px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Submit for review</button>
                ) : (
                  <>
                    <button onClick={() => sign('Approved')} disabled={busy} style={{ padding: '10px 20px', background: '#2a7', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Approve and sign</button>
                    <button onClick={() => sign('Returned')} disabled={busy} style={{ padding: '10px 20px', background: 'white', color: 'crimson', border: '1px solid crimson', borderRadius: 4, cursor: 'pointer' }}>Return with comment</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ background: 'white', padding: 20, borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Sign-off history</h3>
        {signoffs.length === 0 ? (
          <p style={{ color: '#666', margin: 0 }}>No sign-offs yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {signoffs.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 4px' }}>{s.level}</td>
                  <td style={{ padding: '6px 4px', color: s.decision === 'Returned' ? 'crimson' : '#2a7' }}>{s.decision}</td>
                  <td style={{ padding: '6px 4px' }}>{s.signed_name}</td>
                  <td style={{ padding: '6px 4px', color: '#666' }}>{new Date(s.signed_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td style={{ padding: '6px 4px', color: '#666' }}>{s.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
