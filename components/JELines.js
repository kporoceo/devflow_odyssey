'use client';

// All the lines of one journal entry as a small table, with the flagged
// line highlighted. Used under each flag on Run JE Testing and on the
// JE detail page.

const money = (n) => (Number(n) > 0 ? Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

export default function JELines({ lines, highlightId, flagsByLine = {} }) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return (
    <div className="table-wrap">
      <table className="compact" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th>Account title</th>
            <th>Description</th>
            <th className="num">Debit (₱)</th>
            <th className="num">Credit (₱)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const flagged = l.id === highlightId || (flagsByLine[l.id] || []).length > 0;
            return (
              <tr key={l.id} className={l.id === highlightId ? 'row-flagged' : undefined}>
                <td style={{ paddingLeft: Number(l.credit) > 0 ? 28 : undefined }}>
                  {l.account}
                  {flagged && <span className="badge badge-danger" style={{ fontSize: 11, marginLeft: 8 }}>flagged</span>}
                </td>
                <td className="text-2">{l.description}</td>
                <td className="num">{money(l.debit)}</td>
                <td className="num">{money(l.credit)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total</td>
            <td className="num">{money(totalDebit)}</td>
            <td className="num">{money(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
