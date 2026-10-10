'use client';

// Small chart pieces for the Analytics page, drawn with plain SVG and HTML
// (no chart library to install). Colours come from app/globals.css: navy
// for amounts, ODCC gold only to pick out weekend/holiday entries, and
// light-to-dark navy for heat tables. Dark mode swaps them automatically.

import { useState } from 'react';

export const BLUE = 'var(--chart-1)';
export const ORANGE = 'var(--chart-2)';
const HEAT = [14, 28, 44, 60, 78, 100].map((p) => `color-mix(in srgb, var(--chart-1) ${p}%, var(--surface))`);
const INK = 'var(--text)';
const MUTED = 'var(--text-2)';
const GRID = 'var(--chart-grid)';

export function peso(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ₱1.25M, ₱320K, ₱950
export function pesoShort(n) {
  const v = Number(n || 0);
  const a = Math.abs(v);
  if (a >= 1e9) return `₱${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `₱${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `₱${(v / 1e3).toFixed(0)}K`;
  return `₱${v.toFixed(0)}`;
}

// The heading bar above each part of the page, like Arch's dashboard:
// navy with a thin gold underline.
export function SectionTitle({ children }) {
  return (
    <div style={{ background: 'var(--navy)', color: '#fff', padding: '9px 16px', fontWeight: 600, fontSize: 13, letterSpacing: '0.02em', borderBottom: '2px solid var(--gold)' }}>
      {children}
    </div>
  );
}

export function Panel({ title, children, note }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 16, boxShadow: 'var(--shadow)' }}>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ padding: 16 }}>
        {note && <p style={{ margin: '0 0 8px', color: MUTED, fontSize: 13 }}>{note}</p>}
        {children}
      </div>
    </div>
  );
}

export function Tile({ title, value, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12, textAlign: 'center', boxShadow: 'var(--shadow)' }}>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ fontSize: 28, fontWeight: 600, padding: '14px 8px 2px', color: INK, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12, color: MUTED, padding: '0 8px 14px', minHeight: 14 }}>{sub}</div>
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 12, color: MUTED, marginBottom: 6 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: 'inline-block' }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Vertical bars. data: [{ label, value, color?, tip? }]. Hover a bar to see its value.
// Pass integer for counts, so the axis never shows 1.5 entries.
export function ColumnChart({ data, format = pesoShort, height = 220, integer = false, emptyText = 'No data for this view.' }) {
  const [hover, setHover] = useState(null);
  if (!data || data.length === 0) return <p style={{ color: MUTED, fontSize: 13 }}>{emptyText}</p>;

  const width = 760;
  const pad = { top: 18, right: 8, bottom: 44, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const top = Math.max(...data.map((d) => d.value), 0) || 1;
  const max = integer ? Math.max(2, Math.ceil(top / 2) * 2) : top;
  const step = innerW / data.length;
  const barW = Math.max(2, Math.min(48, step - 2)); // 2px gap between bars
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const showEvery = Math.ceil(data.length / 16); // thin out x labels when crowded
  const maxChars = Math.max(4, Math.floor((step * showEvery) / 6.5));

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
        {ticks.map((t, i) => {
          const y = pad.top + innerH - (t / max) * innerH;
          return (
            <g key={i}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} style={{ stroke: GRID }} strokeWidth="1" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="11" style={{ fill: MUTED }}>{format(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = pad.left + i * step + (step - barW) / 2;
          const y = pad.top + innerH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.label + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* invisible wider hit area */}
              <rect x={pad.left + i * step} y={pad.top} width={step} height={innerH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${pad.top + innerH} L${x},${y + r} Q${x},${y} ${x + r},${y}`
                    + ` L${x + barW - r},${y} Q${x + barW},${y} ${x + barW},${y + r} L${x + barW},${pad.top + innerH} Z`}
                  style={{ fill: d.color || BLUE }}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % showEvery === 0 && (
                <text x={pad.left + i * step + step / 2} y={height - pad.bottom + 14} textAnchor="middle" fontSize="11" style={{ fill: MUTED }}>
                  {String(d.label).length > maxChars ? `${String(d.label).slice(0, maxChars - 1)}…` : d.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} style={{ stroke: 'var(--border-strong)' }} strokeWidth="1" />
      </svg>
      {hover !== null && (
        <div style={{
          position: 'absolute', top: 0, left: `${((pad.left + hover * step + step / 2) / width) * 100}%`,
          transform: 'translateX(-50%)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)',
          padding: '4px 8px', fontSize: 12, color: INK, pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-hover)',
        }}>
          <strong>{data[hover].label}</strong>: {data[hover].tip || format(data[hover].value)}
        </div>
      )}
    </div>
  );
}

// Horizontal bars with the label on the left and the value on the right.
export function BarList({ rows, format = pesoShort, max, emptyText = 'Nothing to show.' }) {
  if (!rows || rows.length === 0) return <p style={{ color: MUTED, fontSize: 13 }}>{emptyText}</p>;
  const top = max || Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${format(r.value)}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 34%) 1fr 80px', gap: 8, alignItems: 'center' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: INK }}>{r.label}</span>
          <span style={{ background: 'var(--surface-2)', borderRadius: 3, height: 12 }}>
            <span style={{ display: 'block', height: 12, borderRadius: 3, width: `${Math.max(0, Math.min(100, (r.value / top) * 100))}%`, background: r.color || BLUE }} />
          </span>
          <span style={{ textAlign: 'right', color: INK }}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// A table where each number cell is shaded light to dark blue by size.
export function HeatTable({ rowLabels, colLabels, value, format = pesoShort, rowHeader = '' }) {
  if (rowLabels.length === 0 || colLabels.length === 0) return <p style={{ color: MUTED, fontSize: 13 }}>Nothing to show.</p>;
  let max = 0;
  rowLabels.forEach((r) => colLabels.forEach((c) => { max = Math.max(max, Math.abs(value(r, c) || 0)); }));
  const shade = (v) => {
    if (!v) return { background: 'transparent', color: MUTED };
    const i = Math.min(HEAT.length - 1, Math.floor((Math.abs(v) / (max || 1)) * HEAT.length));
    return { background: HEAT[i], color: i >= 3 ? 'var(--surface)' : INK };
  };
  return (
    <div>
      <table className="heat-table" style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 11, width: '100%', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: MUTED, fontWeight: 500, padding: '2px 4px', width: 110 }}>{rowHeader}</th>
            {colLabels.map((c) => <th key={c} style={{ color: MUTED, fontWeight: 500, padding: '2px 2px', textAlign: 'center', lineHeight: 1.2 }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((r) => (
            <tr key={r}>
              <td style={{ padding: '2px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: INK }} title={r}>{r}</td>
              {colLabels.map((c) => {
                const v = value(r, c);
                return (
                  <td key={c} title={v ? `${r}, ${c}: ${peso(v)}` : ''} style={{ ...shade(v), padding: '3px 3px', textAlign: 'center', borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {v ? format(v) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A plain scrolling table. columns: [{ key, label, align?, format? }]
// Shows the first 10 rows; "Show more" opens the rest (up to maxRows), so
// there's no small scroll box inside the page.
export function DataTable({ columns, rows, maxRows = 200, emptyText = 'No entries.' }) {
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return <p style={{ color: MUTED, fontSize: 13 }}>{emptyText}</p>;
  const limit = open ? maxRows : Math.min(10, maxRows);
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || 'left', padding: '7px 8px' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: '6px 8px', textAlign: c.align || 'left', color: INK, whiteSpace: c.wrap ? 'normal' : 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {c.format ? c.format(r[c.key], r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && !open && (
        <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
          Show more ({Math.min(rows.length, maxRows) - limit} more rows)
        </button>
      )}
      {open && rows.length > maxRows && <p style={{ fontSize: 12, color: MUTED }}>Showing the first {maxRows} of {rows.length}. Download the CSV for all of them.</p>}
    </div>
  );
}
