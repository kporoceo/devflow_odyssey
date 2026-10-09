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
import { teamOf, isLeadership, isAuditTeam, SIGNOFF_LEVELS, STATUS_COLORS } from '../../lib/roles';
import { Panel, BarList, BLUE } from '../../components/charts';

const STAGES = ['Draft', 'Returned', 'For Review', 'For Partner Approval', 'For Client Approval', 'Signed Off'];

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

  const card = { background: 'white', padding: 16, borderRadius: 8, textDecoration: 'none', color: 'inherit', display: 'block' };
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
    todo.push({ href: `/reports/${r.id}`, text: `Sign off "${r.title}"`, sub: `${e ? e.client_name : ''} · ${r.status}`, color: STATUS_COLORS[r.status] });
  });
  if (audit) {
    rows.forEach((r) => {
      if (r.flagged - r.reviewedCount > 0) {
        todo.push({ href: `/engagements/${r.id}/testing`, text: `Review ${r.flagged - r.reviewedCount} flagged line(s)`, sub: `${r.client_name} – ${r.engagement_name}`, color: '#c60' });
      }
      if (r.lines > 0 && !r.run) {
        todo.push({ href: `/engagements/${r.id}/testing`, text: `Run JE testing on ${r.lines.toLocaleString()} uploaded lines`, sub: `${r.client_name} – ${r.engagement_name}`, color: BLUE });
      }
      if (r.lines === 0) {
        todo.push({ href: `/engagements/${r.id}/upload`, text: 'Upload the JE data', sub: `${r.client_name} – ${r.engagement_name}`, color: '#666' });
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

  const th = { textAlign: 'left', padding: '6px 8px', color: '#666', fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', borderBottom: '1px solid #eee' };
  const td = { padding: '8px', fontSize: 14, borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' };

  return (
    <div style={{ maxWidth: 1100, margin: '32px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Welcome, {profile.full_name || profile.email}</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        {profile.role} · {teamOf(profile.role)} · {new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {!data && <p>Loading…</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '20px 0' }}>
            {tiles.map((t) => {
              const inner = (
                <>
                  <div style={{ fontSize: 30, fontWeight: 'bold', color: t.warn ? '#c60' : 'inherit' }}>{t.value}</div>
                  <div style={{ color: '#666', fontSize: 13 }}>{t.label}</div>
                </>
              );
              return t.href
                ? <Link key={t.label} href={t.href} style={card}>{inner}</Link>
                : <div key={t.label} style={card}>{inner}</div>;
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
            <Panel title="Needs your attention">
              {todo.length === 0 && <p style={{ color: '#666', margin: 0 }}>Nothing waiting for you right now.</p>}
              {todo.slice(0, 8).map((t, i) => (
                <Link key={i} href={t.href} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #f0f0f0', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: t.color, marginTop: 7, flexShrink: 0 }} />
                  <span>
                    <span style={{ display: 'block', fontSize: 14 }}>{t.text}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#666' }}>{t.sub}</span>
                  </span>
                </Link>
              ))}
              {todo.length > 8 && <p style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>And {todo.length - 8} more.</p>}
            </Panel>

            <Panel title="Reports by stage">
              <BarList
                rows={STAGES.map((s) => ({ label: s, value: data.reports.filter((r) => r.status === s).length, color: s === 'Signed Off' ? '#2a7' : BLUE }))}
                format={(n) => String(n)}
                max={Math.max(1, ...STAGES.map((s) => data.reports.filter((r) => r.status === s).length))}
              />
              <p style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>
                {data.reports.length} report(s) in all. Sign-off order: Preparer, A&amp;A Lead, Partner, Client.
              </p>
            </Panel>
          </div>

          <Panel title="Engagement progress">
            {rows.length === 0 && <p style={{ color: '#666', margin: 0 }}>No engagements yet.</p>}
            {rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Client · Engagement</th>
                      <th style={{ ...th, textAlign: 'right' }}>Lines</th>
                      <th style={th}>Last tested</th>
                      <th style={th}>Flags reviewed</th>
                      <th style={{ ...th, textAlign: 'right' }}>Open AJEs</th>
                      <th style={th}>Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const pct = r.flagged ? Math.round((r.reviewedCount / r.flagged) * 100) : null;
                      return (
                        <tr key={r.id}>
                          <td style={td}>
                            <Link href={`/engagements/${r.id}`}>{r.engagement_name}</Link>
                            <div style={{ fontSize: 12, color: '#666' }}>{r.client_name}</div>
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>{r.lines.toLocaleString()}</td>
                          <td style={td}>{day(r.run?.run_at)}</td>
                          <td style={{ ...td, minWidth: 150 }}>
                            {pct === null
                              ? <span style={{ color: '#666', fontSize: 13 }}>{r.run ? 'No flags' : '—'}</span>
                              : (
                                <div title={`${r.reviewedCount} of ${r.flagged} flagged lines reviewed`}>
                                  <div style={{ background: '#f0efec', borderRadius: 4, height: 8 }}>
                                    <div style={{ width: `${pct}%`, background: pct === 100 ? '#2a7' : BLUE, height: 8, borderRadius: 4 }} />
                                  </div>
                                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{r.reviewedCount} of {r.flagged} ({pct}%)</div>
                                </div>
                              )}
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: r.openAdjustments ? '#c60' : 'inherit' }}>{r.openAdjustments}</td>
                          <td style={td}>
                            {r.report
                              ? <Link href={`/reports/${r.report.id}`} style={{ color: STATUS_COLORS[r.report.status] || 'inherit' }}>{r.report.status}</Link>
                              : <span style={{ color: '#666', fontSize: 13 }}>None yet</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Recent activity">
            {data.activity.length === 0 && <p style={{ color: '#666', margin: 0 }}>No test runs or sign-offs yet.</p>}
            {data.activity.map((a, i) => (
              <Link key={i} href={a.href} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid #f0f0f0', textDecoration: 'none', color: 'inherit', fontSize: 14 }}>
                <span>{a.text}</span>
                <span style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>{when(a.at)}</span>
              </Link>
            ))}
          </Panel>

          {isLeadership(profile.role) && (
            <Link href="/admin/users" style={{ ...card, maxWidth: 320 }}>
              <div style={{ fontSize: 18, fontWeight: 'bold' }}>Manage Users</div>
              <div style={{ color: '#666' }}>Create accounts and set roles</div>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
