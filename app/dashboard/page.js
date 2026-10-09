'use client';

// The home page for firm staff. Everything here is read from data the app
// already saves (engagements, uploads, test runs, flag reviews, adjusting
// entries, reports and sign-offs), so it is always up to date. Nothing on
// this page changes data. Clients land on Reports instead (lib/roles.js).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { fetchAll } from '../../lib/fetchAll';
import { useProfile } from '../../components/AppShell';
import { teamOf, isLeadership, isAuditTeam, SIGNOFF_LEVELS } from '../../lib/roles';
import { BarList, BLUE } from '../../components/charts';

const STAGES = ['Draft', 'Returned', 'For Review', 'For Partner Approval', 'For Client Approval', 'Signed Off'];

// Report status colours, from app/globals.css (badges and to-do dots).
const STATUS_BADGE = {
  'Draft': 'badge',
  'Returned': 'badge badge-danger',
  'For Review': 'badge badge-warning',
  'For Partner Approval': 'badge badge-warning',
  'For Client Approval': 'badge badge-warning',
  'Signed Off': 'badge badge-success',
};
const STATUS_DOT = {
  'Draft': 'var(--muted)',
  'Returned': 'var(--danger)',
  'For Review': 'var(--warning)',
  'For Partner Approval': 'var(--warning)',
  'For Client Approval': 'var(--warning)',
  'Signed Off': 'var(--success)',
};

function when(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function day(ts) {
  return ts ? new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not yet';
}

export default function Dashboard() {
  const { profile } = useProfile();
  const [data, setData] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const { data: engagements } = await supabase
        .from('engagements')
        .select('id, client_name, engagement_name, status, created_at')
        .order('created_at', { ascending: false });
      const engs = engagements || [];

      // Lines uploaded per engagement (counted by the database, not downloaded).
      const lineCounts = await Promise.all(engs.map((e) => supabase
        .from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('engagement_id', e.id)
        .then(({ count }) => count || 0)));

      // Latest saved test run per engagement, and its flagged lines.
      const { data: runs } = await fetchAll(() => supabase
        .from('je_test_results')
        .select('id, engagement_id, run_at, total_entries, flagged_count, profiles(full_name)')
        .order('run_at', { ascending: false })
        .order('id'));
      const latestRun = {};
      (runs || []).forEach((r) => { if (!latestRun[r.engagement_id]) latestRun[r.engagement_id] = r; });
      const latestIds = Object.values(latestRun).map((r) => r.id);
      const { data: flags } = latestIds.length
        ? await fetchAll(() => supabase.from('je_test_flags').select('id, test_result_id, journal_entry_id').in('test_result_id', latestIds).order('id'))
        : { data: [] };
      const { data: reviews } = await fetchAll(() => supabase.from('flag_reviews').select('id, journal_entry_id').order('id'));
      const reviewed = new Set((reviews || []).map((r) => r.journal_entry_id));
      const flaggedLines = {}; // run id -> Set of flagged line ids
      (flags || []).forEach((f) => {
        flaggedLines[f.test_result_id] = flaggedLines[f.test_result_id] || new Set();
        flaggedLines[f.test_result_id].add(f.journal_entry_id);
      });

      const { data: adjustments } = await fetchAll(() => supabase.from('adjusting_entries').select('id, engagement_id, status').order('id'));
      const { data: reports } = await fetchAll(() => supabase
        .from('reports')
        .select('id, engagement_id, title, status, updated_at')
        .order('updated_at', { ascending: false })
        .order('id'));
      const { data: signoffs } = await supabase
        .from('report_signoffs')
        .select('id, level, decision, signed_name, signed_at, reports(id, title)')
        .order('signed_at', { ascending: false })
        .limit(8);

      const rows = engs.map((e, i) => {
        const run = latestRun[e.id];
        const lines = run ? [...(flaggedLines[run.id] || [])] : [];
        const done = lines.filter((id) => reviewed.has(id)).length;
        const engReports = (reports || []).filter((r) => r.engagement_id === e.id);
        return {
          ...e,
          lines: lineCounts[i],
          run,
          flagged: lines.length,
          reviewedCount: done,
          openAdjustments: (adjustments || []).filter((a) => a.engagement_id === e.id && a.status === 'Proposed').length,
          report: engReports[0] || null,
        };
      });

      const myStatuses = SIGNOFF_LEVELS.filter((s) => s.canAct(profile.role)).map((s) => s.status);
      const waitingReports = (reports || []).filter((r) => myStatuses.includes(r.status));

      // Recent activity: test runs and sign-offs, newest first.
      const activity = [
        ...(runs || []).slice(0, 8).map((r) => {
          const e = engs.find((x) => x.id === r.engagement_id);
          return {
            at: r.run_at,
            text: `${r.profiles?.full_name || 'Someone'} ran JE testing on ${e ? `${e.client_name} – ${e.engagement_name}` : 'an engagement'}: ${Number(r.flagged_count).toLocaleString()} of ${Number(r.total_entries).toLocaleString()} lines flagged`,
            // Testing History is Audit Team and Leadership only (AppShell).
            href: isAuditTeam(profile.role) || isLeadership(profile.role) ? `/engagements/${r.engagement_id}/history` : `/engagements/${r.engagement_id}`,
          };
        }),
        ...(signoffs || []).map((s) => ({
          at: s.signed_at,
          text: `${s.signed_name} ${s.decision.toLowerCase()} "${s.reports?.title || 'a report'}" at ${s.level} level`,
          href: s.reports ? `/reports/${s.reports.id}` : '/reports',
        })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);

      setData({ rows, reports: reports || [], waitingReports, activity, adjustments: adjustments || [] });
    }
    load();
  }, [profile]);

  if (!profile) return null;

  const audit = isAuditTeam(profile.role);
  const rows = data?.rows || [];
  const active = rows.filter((r) => r.status !== 'Closed');
  const totalLines = rows.reduce((s, r) => s + r.lines, 0);
  const unreviewed = rows.reduce((s, r) => s + (r.flagged - r.reviewedCount), 0);
  const openAdj = (data?.adjustments || []).filter((a) => a.status === 'Proposed').length;

  // The to-do list depends on what this person can act on.
  const todo = [];
  (data?.waitingReports || []).forEach((r) => {
    const e = rows.find((x) => x.id === r.engagement_id);
    todo.push({ href: `/reports/${r.id}`, text: `Sign off "${r.title}"`, sub: `${e ? e.client_name : ''} · ${r.status}`, color: STATUS_DOT[r.status] });
  });
  if (audit) {
    rows.forEach((r) => {
      if (r.flagged - r.reviewedCount > 0) {
        todo.push({ href: `/engagements/${r.id}/testing`, text: `Review ${r.flagged - r.reviewedCount} flagged line(s)`, sub: `${r.client_name} – ${r.engagement_name}`, color: 'var(--warning)' });
      }
      if (r.lines > 0 && !r.run) {
        todo.push({ href: `/engagements/${r.id}/testing`, text: `Run JE testing on ${r.lines.toLocaleString()} uploaded lines`, sub: `${r.client_name} – ${r.engagement_name}`, color: BLUE });
      }
      if (r.lines === 0) {
        todo.push({ href: `/engagements/${r.id}/upload`, text: 'Upload the JE data', sub: `${r.client_name} – ${r.engagement_name}`, color: 'var(--muted)' });
      }
    });
  }

  const tiles = [
    { label: 'Active engagements', value: active.length, href: '/engagements' },
    { label: 'JE lines uploaded', value: totalLines.toLocaleString(), href: '/engagements' },
    { label: 'Flagged lines not yet reviewed', value: unreviewed.toLocaleString(), warn: unreviewed > 0 },
    { label: 'Adjusting entries waiting for the client', value: openAdj, warn: openAdj > 0, href: '/reports' },
    { label: 'Reports waiting for you', value: data?.waitingReports.length ?? 0, warn: (data?.waitingReports.length || 0) > 0, href: '/reports?waiting=1' },
  ];

  const listRow = { display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome, {profile.full_name || profile.email}</h1>
          <p className="page-subtitle">
            {profile.role} · {teamOf(profile.role)} · {new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      {!data && <p className="loading">Loading…</p>}

      {data && (
        <div className="stack-lg">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            {tiles.map((t) => {
              const inner = (
                <>
                  <div className="stat-label">{t.label}</div>
                  <div className={t.warn ? 'stat-value text-warning' : 'stat-value'}>{t.value}</div>
                </>
              );
              return t.href
                ? <Link key={t.label} href={t.href} className="stat">{inner}</Link>
                : <div key={t.label} className="stat">{inner}</div>;
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
            <section className="card">
              <div className="card-header"><h2 className="card-title">Needs your attention</h2></div>
              {todo.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing waiting for you right now.</p>}
              {todo.slice(0, 8).map((t, i) => (
                <Link key={i} href={t.href} style={listRow}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, marginTop: 8, flexShrink: 0 }} />
                  <span>
                    <span style={{ display: 'block', fontSize: 14, color: 'var(--text)' }}>{t.text}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>{t.sub}</span>
                  </span>
                </Link>
              ))}
              {todo.length > 8 && <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>And {todo.length - 8} more.</p>}
            </section>

            <section className="card">
              <div className="card-header"><h2 className="card-title">Reports by stage</h2></div>
              <BarList
                rows={STAGES.map((s) => ({ label: s, value: data.reports.filter((r) => r.status === s).length, color: s === 'Signed Off' ? 'var(--success)' : BLUE }))}
                format={(n) => String(n)}
                max={Math.max(1, ...STAGES.map((s) => data.reports.filter((r) => r.status === s).length))}
              />
              <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
                {data.reports.length} report(s) in all. Sign-off order: Preparer, A&amp;A Lead, Partner, Client.
              </p>
            </section>
          </div>

          <section className="card">
            <div className="card-header"><h2 className="card-title">Engagement progress</h2></div>
            {rows.length === 0 && <p className="muted" style={{ margin: 0 }}>No engagements yet.</p>}
            {rows.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Client · Engagement</th>
                      <th className="num">Lines</th>
                      <th>Last tested</th>
                      <th>Flags reviewed</th>
                      <th className="num">Open AJEs</th>
                      <th>Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const pct = r.flagged ? Math.round((r.reviewedCount / r.flagged) * 100) : null;
                      return (
                        <tr key={r.id}>
                          <td>
                            <Link href={`/engagements/${r.id}`}>{r.engagement_name}</Link>
                            <div className="muted" style={{ fontSize: 12 }}>{r.client_name}</div>
                          </td>
                          <td className="num">{r.lines.toLocaleString()}</td>
                          <td>{day(r.run?.run_at)}</td>
                          <td style={{ minWidth: 150 }}>
                            {pct === null
                              ? <span className="muted small">{r.run ? 'No flags' : '—'}</span>
                              : (
                                <div title={`${r.reviewedCount} of ${r.flagged} flagged lines reviewed`}>
                                  <div className="progress">
                                    <span style={{ width: `${pct}%`, background: pct === 100 ? 'var(--success)' : BLUE }} />
                                  </div>
                                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{r.reviewedCount} of {r.flagged} ({pct}%)</div>
                                </div>
                              )}
                          </td>
                          <td className={r.openAdjustments ? 'num text-warning' : 'num'}>{r.openAdjustments}</td>
                          <td>
                            {r.report
                              ? <Link href={`/reports/${r.report.id}`} className={STATUS_BADGE[r.report.status] || 'badge'}>{r.report.status}</Link>
                              : <span className="muted small">None yet</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-header"><h2 className="card-title">Recent activity</h2></div>
            {data.activity.length === 0 && <p className="muted" style={{ margin: 0 }}>No test runs or sign-offs yet.</p>}
            {data.activity.map((a, i) => (
              <Link key={i} href={a.href} style={{ ...listRow, justifyContent: 'space-between', gap: 16, fontSize: 14 }}>
                <span style={{ color: 'var(--text)' }}>{a.text}</span>
                <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{when(a.at)}</span>
              </Link>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
