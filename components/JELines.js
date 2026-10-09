'use client';

// All the lines of one journal entry as a small table, with the flagged
// line highlighted. Used under each flag on Run JE Testing and on the
// JE detail page.

const money = (n) => (Number(n) > 0 ? Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

export default function JELines({ lines, highlightId, flagsByLine = {} }) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const th = { textAlign: 'left', padding: '4px 6px', color: '#666', fontWeight: 500, whiteSpace: 'nowrap' };
  const td = { padding: '4px 6px', borderTop: '1px solid #eee' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>Account title</th>
            <th style={th}>Description</th>
            <th style={{ ...th, textAlign: 'right' }}>Debit (₱)</th>
            <th style={{ ...th, textAlign: 'right' }}>Credit (₱)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const flagged = l.id === highlightId || (flagsByLine[l.id] || []).length > 0;
            return (
              <tr key={l.id} style={{ background: l.id === highlightId ? '#fdeaea' : 'transparent' }}>
                <td style={{ ...td, paddingLeft: Number(l.credit) > 0 ? 22 : 6 }}>
                  {l.account}
                  {flagged && <span style={{ color: '#a33', fontSize: 11, marginLeft: 6 }}>flagged</span>}
                </td>
                <td style={{ ...td, color: '#555' }}>{l.description}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.debit)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.credit)}</td>
              </tr>
            );
          })}
          <tr>
            <td style={{ ...td, fontWeight: 600 }} colSpan={2}>Total</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(totalDebit)}</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(totalCredit)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
