'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { createClient } from '../../../../lib/supabaseClient';
import { groupJournalEntries, classifyAccount } from '../../../../lib/jeTesting';
import { askAI } from '../../../../lib/ai';
import { BackLink, BusyLabel, ClaudeTag, Spinner } from '../../../../components/ui';
import { fetchAll } from '../../../../lib/fetchAll';

const REQUIRED_COLUMNS = ['date', 'account', 'description', 'debit', 'credit'];

// Optional columns the 7 JE rules use. Each field lists the header names
// clients commonly use for it (after normalizeHeader). A rule whose column
// is missing shows "Not applicable" on the Run page instead of failing.
const OPTIONAL_COLUMNS = {
  effective_date: ['effective_date', 'transaction_date', 'document_date', 'doc_date', 'gl_date'],
  entered_by: ['prepared_by', 'preparer', 'entered_by', 'created_by', 'posted_by', 'user'],
  je_number: ['je_no', 'je_number', 'journal_no', 'journal_number', 'entry_no', 'jv_no', 'voucher_no', 'reference', 'ref'],
  source: ['source', 'transaction_type', 'source_type', 'type'],
  account_class: ['account_type', 'account_class', 'class'],
};

const FIELD_LABELS = {
  date: 'Date (entry date) *',
  account: 'Account *',
  description: 'Description *',
  debit: 'Debit *',
  credit: 'Credit *',
  effective_date: 'Effective Date (rule 2)',
  entered_by: 'Prepared By (rule 5)',
  je_number: 'JE No. (rule 6)',
  source: 'Source (rule 7)',
  account_class: 'Account Type (rules 5 and 6)',
};
const ALL_FIELDS = Object.keys(FIELD_LABELS);
const CLASS_OPTIONS = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense', 'Suspense'];
const SOURCE_LABELS = { File: 'from file', Saved: 'saved before', Guess: 'guess', AI: 'Claude suggestion', Person: 'you chose' };

// Extensions we actually know how to read.
const SUPPORTED_EXTENSIONS = ['csv', 'xlsx', 'xls'];

// Common file types clients might mistakenly send, mapped to a helpful
// message instead of a raw crash.
const KNOWN_UNSUPPORTED = {
  pdf: 'PDF files can\'t be read as data. Please ask for an Excel (.xlsx) or CSV export of the ledger instead.',
  doc: 'Word documents can\'t be read as data. Please ask for an Excel (.xlsx) or CSV export instead.',
  docx: 'Word documents can\'t be read as data. Please ask for an Excel (.xlsx) or CSV export instead.',
  numbers: 'Apple Numbers files aren\'t supported. Please export as Excel (.xlsx) or CSV from Numbers first.',
  png: 'Images can\'t be read as data. Please ask for the actual Excel or CSV file, not a screenshot.',
  jpg: 'Images can\'t be read as data. Please ask for the actual Excel or CSV file, not a screenshot.',
  jpeg: 'Images can\'t be read as data. Please ask for the actual Excel or CSV file, not a screenshot.',
  zip: 'Zipped folders aren\'t supported. Please extract and upload the individual Excel or CSV file.',
};

// "JE No." -> "je_no", "Prepared By" -> "prepared_by"
function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

// Real client exports often start with title rows ("ABC Corp", "General
// Ledger", "For the year ended ...") before the column headings. The
// heading row is the first of the top 30 rows that is about as wide as the
// widest row there (at least 3 filled cells). Rows above it are skipped.
function findHeaderRow(grid) {
  const filled = (row) => (row || []).filter((c) => String(c ?? '').trim() !== '').length;
  const top = grid.slice(0, 30);
  const widest = Math.max(0, ...top.map(filled));
  const need = Math.max(3, Math.ceil(widest * 0.6));
  const i = top.findIndex((row) => filled(row) >= need);
  return i === -1 ? 0 : i;
}

// Turns a grid (rows of cells) into headings plus one object per row.
// Blank headings become "Column 4"; repeated ones get "(2)". Each row
// remembers its row number in the file (not sent anywhere) so error
// messages point at the right row.
function gridToTable(grid) {
  const headerIndex = findHeaderRow(grid);
  const seen = {};
  const headers = (grid[headerIndex] || []).map((h, i) => {
    let name = String(h ?? '').trim() || `Column ${i + 1}`;
    seen[name] = (seen[name] || 0) + 1;
    if (seen[name] > 1) name = `${name} (${seen[name]})`;
    return name;
  });
  const rows = [];
  grid.slice(headerIndex + 1).forEach((cells, i) => {
    if (!cells || cells.every((c) => String(c ?? '').trim() === '')) return;
    const row = {};
    headers.forEach((h, j) => { row[h] = cells[j] ?? ''; });
    Object.defineProperty(row, '__row', { value: headerIndex + i + 2, enumerable: false });
    rows.push(row);
  });
  return { headers, rows, headerRow: headerIndex + 1 };
}

// Rough number of rows in a sheet, from its used range, without reading it.
function sheetRowCount(sheet) {
  if (!sheet || !sheet['!ref']) return 0;
  return XLSX.utils.decode_range(sheet['!ref']).e.r + 1;
}

// Turns a date cell into "YYYY-MM-DD", or null if it isn't a date.
// Handles ISO text (2026-08-01), other text dates (8/1/2026), and Excel's
// serial numbers (45870). Building the string ourselves avoids the +8
// timezone moving a date back one day.
function parseDateCell(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  if (/^\d+(\.\d+)?$/.test(text)) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

function peso(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function UploadJEData({ params }) {
  const { id: engagementId } = params;
  const [fileName, setFileName] = useState('');
  const [clientName, setClientName] = useState('');
  const [rawHeaders, setRawHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [sheets, setSheets] = useState([]);         // Excel only: [{ name, rows }]
  const [sheetName, setSheetName] = useState('');
  const [inactive, setInactive] = useState(false);
  const [headerRow, setHeaderRow] = useState(1);
  const workbookRef = useRef(null);
  const [mapping, setMapping] = useState({});        // ODYSSEY field -> client's column name
  const [mappingByAI, setMappingByAI] = useState(false);
  const [parsedRows, setParsedRows] = useState([]);
  const [accountClasses, setAccountClasses] = useState({}); // account -> { class, source }
  const [validationErrors, setValidationErrors] = useState([]);
  const [status, setStatus] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.from('engagements').select('client_name, status').eq('id', engagementId).single()
      .then(({ data }) => {
        setClientName(data?.client_name || '');
        setInactive(data?.status === 'Inactive');
      });
  }, [engagementId]);

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setValidationErrors([]);
    setParsedRows([]);
    setSaveMessage('');
    setAiMessage('');
    setMappingByAI(false);

    const ext = getExtension(file.name);

    if (KNOWN_UNSUPPORTED[ext]) {
      setValidationErrors([KNOWN_UNSUPPORTED[ext]]);
      setStatus('error');
      return;
    }

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setValidationErrors([
        `".${ext}" files aren't supported. Please upload a CSV (.csv) or Excel (.xlsx, .xls) file.`,
      ]);
      setStatus('error');
      return;
    }

    setStatus('validating');

    workbookRef.current = null;
    setSheets([]);
    setSheetName('');

    if (ext === 'csv') {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const table = gridToTable(results.data);
          handleFileRead(table.headers, table.rows, table.headerRow);
        },
        error: (err) => {
          setValidationErrors([`Could not read file: ${err.message}`]);
          setStatus('error');
        },
      });
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const workbook = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
          workbookRef.current = workbook;
          const list = workbook.SheetNames.map((name) => ({ name, rows: sheetRowCount(workbook.Sheets[name]) }));
          setSheets(list);
          // Start with the biggest sheet; it's usually the ledger. The
          // person can pick another one from the list.
          const biggest = list.reduce((a, b) => (b.rows > a.rows ? b : a), list[0]);
          readSheet(biggest.name);
        } catch (err) {
          setValidationErrors([`Could not read Excel file: ${err.message}`]);
          setStatus('error');
        }
      };
      reader.onerror = () => {
        setValidationErrors(['Could not read the file. It may be corrupted.']);
        setStatus('error');
      };
      reader.readAsArrayBuffer(file);
    }
  }

  // Step 1: work out which column is which.
  // First the usual names, then this client's saved matching (if every
  // saved column is in this file). If a required one is still missing,
  // the person matches them (with an AI suggestion if they want).
  // Excel: read one sheet of the workbook (first time, or when the person
  // picks another sheet from the list).
  function readSheet(name) {
    const workbook = workbookRef.current;
    if (!workbook) return;
    setSheetName(name);
    setValidationErrors([]);
    setParsedRows([]);
    setSaveMessage('');
    setAiMessage('');
    setMappingByAI(false);
    setStatus('validating');
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
    const table = gridToTable(grid);
    handleFileRead(table.headers, table.rows, table.headerRow);
  }

  async function handleFileRead(headers, rows, foundHeaderRow = 1) {
    setRawHeaders(headers);
    setRawRows(rows);
    setHeaderRow(foundHeaderRow);
    if (rows.length === 0) {
      setValidationErrors(['This sheet has no data rows.']);
      setStatus('error');
      return;
    }

    const byNormalized = {};
    headers.forEach((h) => { byNormalized[normalizeHeader(h)] = h; });
    const auto = {};
    REQUIRED_COLUMNS.forEach((f) => { if (byNormalized[f] !== undefined) auto[f] = byNormalized[f]; });
    Object.entries(OPTIONAL_COLUMNS).forEach(([field, names]) => {
      const found = names.find((n) => byNormalized[n] !== undefined);
      if (found) auto[field] = byNormalized[found];
    });

    let start = auto;
    if (clientName) {
      const { data: saved } = await supabase.from('column_maps').select('map').eq('client_name', clientName).maybeSingle();
      if (saved?.map && Object.values(saved.map).every((h) => headers.includes(h))) start = saved.map;
    }
    setMapping(start);

    if (REQUIRED_COLUMNS.every((f) => start[f])) {
      await validateAndPrepare(start, headers, rows, foundHeaderRow);
    } else {
      setStatus('mapping');
    }
  }

  async function suggestMappingWithAI() {
    setAiBusy(true);
    setAiMessage('');
    try {
      const { mapping: suggested } = await askAI(supabase, 'map_columns', {
        headers: rawHeaders,
        sample_rows: rawRows.slice(0, 5),
      });
      const clean = {};
      Object.entries(suggested).forEach(([field, header]) => { if (header && rawHeaders.includes(header)) clean[field] = header; });
      setMapping(clean);
      setMappingByAI(true);
      setAiMessage('Claude filled in a suggestion. Check each one, then click Use these columns.');
    } catch (err) {
      setAiMessage(err.message);
    }
    setAiBusy(false);
  }

  async function confirmMapping() {
    const missing = REQUIRED_COLUMNS.filter((f) => !mapping[f]);
    if (missing.length > 0) {
      setAiMessage(`Choose a column for: ${missing.map((f) => FIELD_LABELS[f].replace(' *', '')).join(', ')}.`);
      return;
    }
    const used = Object.values(mapping).filter(Boolean);
    if (new Set(used).size !== used.length) {
      setAiMessage('Each column can only be used once.');
      return;
    }
    // Remember it for this client's next upload.
    if (clientName) {
      await supabase.from('column_maps').upsert({ client_name: clientName, map: mapping, updated_at: new Date().toISOString() });
    }
    setAiMessage('');
    await validateAndPrepare(mapping, rawHeaders, rawRows, headerRow);
  }

  // Step 2: check every row using the chosen columns.
  async function validateAndPrepare(map, headers, dataRows, foundHeaderRow = 1) {
    setValidationErrors([]);
    const rowErrors = [];
    const cleanRows = [];
    const fileRow = {}; // line_no -> row number in the file, for messages

    dataRows.forEach((row, index) => {
      const rowNum = row.__row || index + 2;
      const cell = (field) => (map[field] ? String(row[map[field]] ?? '').trim() : '');
      const dateVal = cell('date');
      const accountVal = cell('account');
      const descVal = cell('description');
      const debitVal = cell('debit').replace(/,/g, '');
      const creditVal = cell('credit').replace(/,/g, '');

      const entryDate = parseDateCell(dateVal);
      if (!entryDate) {
        rowErrors.push(`Row ${rowNum}: invalid or missing date ("${dateVal}")`);
        return;
      }
      if (!accountVal) {
        rowErrors.push(`Row ${rowNum}: missing account`);
        return;
      }
      const debit = parseFloat(debitVal || '0');
      const credit = parseFloat(creditVal || '0');
      if (isNaN(debit) || isNaN(credit)) {
        rowErrors.push(`Row ${rowNum}: debit/credit must be numbers`);
        return;
      }
      if (debit === 0 && credit === 0) {
        rowErrors.push(`Row ${rowNum}: debit and credit can't both be zero`);
        return;
      }

      let effectiveDate = null;
      if (cell('effective_date')) {
        effectiveDate = parseDateCell(cell('effective_date'));
        if (!effectiveDate) {
          rowErrors.push(`Row ${rowNum}: invalid effective date ("${cell('effective_date')}")`);
          return;
        }
      }

      fileRow[index + 1] = rowNum;
      cleanRows.push({
        engagement_id: engagementId,
        line_no: index + 1,
        entry_date: entryDate,
        effective_date: effectiveDate,
        account: accountVal,
        description: descVal,
        debit,
        credit,
        entered_by: cell('entered_by') || null,
        je_number: cell('je_number') || null,
        source: cell('source') || null,
        account_class: cell('account_class') || null,
      });
    });

    if (rowErrors.length > 0) {
      setValidationErrors(rowErrors.slice(0, 20).concat(
        rowErrors.length > 20 ? [`...and ${rowErrors.length - 20} more row error(s).`] : []
      ));
      setStatus('error');
      return;
    }

    // Integrity check: every journal entry must balance (debits = credits).
    // This is a data error, not a risk flag, so nothing is saved if it fails.
    const balanceErrors = [];
    const hasJeNumbers = cleanRows.every((r) => r.je_number);
    groupJournalEntries(cleanRows).forEach((lines) => {
      const diff = lines.reduce((sum, l) => sum + Math.round((l.debit - l.credit) * 100), 0) / 100;
      if (diff !== 0) {
        balanceErrors.push(hasJeNumbers
          ? `JE ${lines[0].je_number}: debits and credits differ by ${peso(Math.abs(diff))}.`
          : `Rows ${fileRow[lines[0].line_no]} to ${fileRow[lines[lines.length - 1].line_no]}: debits and credits differ by ${peso(Math.abs(diff))}.`);
      }
    });
    if (balanceErrors.length > 0) {
      setValidationErrors(['Some journal entries don\'t balance:'].concat(balanceErrors.slice(0, 20)));
      setStatus('error');
      return;
    }

    setSaveMessage(foundHeaderRow > 1 ? `Column headings found on row ${foundHeaderRow}; the ${foundHeaderRow - 1} title row(s) above them were skipped.` : '');

    // Step 3: the account type of every account. Taken from the file if it
    // has a valid one, else from this engagement's saved list, else a guess
    // from the name. The person can change any of them, or ask the AI.
    const { data: saved } = await fetchAll(() => supabase.from('account_classes').select('account, class').eq('engagement_id', engagementId).order('account'));
    const savedMap = Object.fromEntries((saved || []).map((a) => [a.account, a.class]));
    const classes = {};
    cleanRows.forEach((r) => {
      if (classes[r.account]) return;
      const fromFile = CLASS_OPTIONS.find((c) => c.toLowerCase() === String(r.account_class || '').toLowerCase());
      if (fromFile) classes[r.account] = { class: fromFile, source: 'File' };
      else if (savedMap[r.account]) classes[r.account] = { class: savedMap[r.account], source: 'Saved' };
      else {
        const guess = classifyAccount({ account: r.account });
        classes[r.account] = { class: guess === 'Unclassified' ? '' : guess, source: 'Guess' };
      }
    });
    setAccountClasses(classes);
    setParsedRows(cleanRows);
    setStatus('ready');
  }

  async function sortAccountsWithAI() {
    setAiBusy(true);
    setAiMessage('');
    try {
      const toAsk = Object.keys(accountClasses).filter((a) => accountClasses[a].source !== 'File');
      const { classes } = await askAI(supabase, 'classify_accounts', { accounts: toAsk });
      const next = { ...accountClasses };
      Object.entries(classes).forEach(([account, cls]) => {
        if (next[account] && next[account].source !== 'File') next[account] = { class: cls, source: 'AI' };
      });
      setAccountClasses(next);
      setAiMessage(`AI suggested a type for ${Object.keys(classes).length} account(s). Check them before saving.`);
    } catch (err) {
      setAiMessage(err.message);
    }
    setAiBusy(false);
  }

  async function handleConfirmSave() {
    setStatus('saving');
    const { data: { user } } = await supabase.auth.getUser();
    const rowsWithUploader = parsedRows.map((r) => ({
      ...r,
      account_class: accountClasses[r.account]?.class || null,
      uploaded_by: user.id,
    }));

    const BATCH_SIZE = 500;
    try {
      // Save the confirmed account types first, so the next upload reuses them.
      const classRows = Object.entries(accountClasses)
        .filter(([, v]) => v.class)
        .map(([account, v]) => ({
          engagement_id: engagementId,
          account,
          class: v.class,
          source: v.source === 'Saved' ? 'Person' : v.source,
          confirmed_by: user.id,
          updated_at: new Date().toISOString(),
        }));
      if (classRows.length > 0) {
        const { error } = await supabase.from('account_classes').upsert(classRows, { onConflict: 'engagement_id,account' });
        if (error) throw error;
      }

      for (let i = 0; i < rowsWithUploader.length; i += BATCH_SIZE) {
        const batch = rowsWithUploader.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('journal_entries').insert(batch);
        if (error) throw error;
      }
      setSaveMessage(`Successfully saved ${rowsWithUploader.length} journal entries.`);
      setStatus('done');
    } catch (err) {
      setValidationErrors([`Save failed: ${err.message}`]);
      setStatus('error');
    }
  }

  const foundOptional = Object.keys(OPTIONAL_COLUMNS).filter((f) => mapping[f]);
  const accounts = Object.keys(accountClasses).sort();
  const unclassified = accounts.filter((a) => !accountClasses[a].class).length;
  const box = { background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 };
  const aiButton = { padding: '8px 14px', background: '#3b4cca', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' };

  return (
    <div style={{ maxWidth: 760, margin: '40px auto', padding: 24 }}>
      <BackLink href={`/engagements/${engagementId}`}>Back to Engagement</BackLink>
      <h1>Upload JE Data</h1>
      {inactive && (
        <p style={{ background: '#f3f3f3', padding: 12, borderRadius: 6 }}>
          This engagement is <strong>Inactive</strong>, so new entries can&apos;t be uploaded. Firm Leadership can reactivate it.
        </p>
      )}
      <p style={{ color: '#666' }}>
        Upload the client&apos;s CSV or Excel file as it is. ODYSSEY needs a <strong>Date, Account, Description, Debit and Credit</strong> column.
        If the client names them differently, you&apos;ll match them once and ODYSSEY remembers it for this client.
      </p>
      <p style={{ color: '#666', fontSize: 14 }}>
        Optional columns used by the testing rules: <strong>Effective Date, Prepared By, JE No., Source, Account Type</strong>.
      </p>

      <div style={box}>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} disabled={inactive} />
        {fileName && <p style={{ color: '#666', marginTop: 8 }}>Selected: {fileName}</p>}
        {sheets.length > 1 && (
          <p style={{ marginBottom: 0 }}>
            <label>
              This workbook has {sheets.length} sheets. Sheet with the journal entries:{' '}
              <select value={sheetName} onChange={(e) => readSheet(e.target.value)} disabled={status === 'saving'}>
                {sheets.map((sh) => <option key={sh.name} value={sh.name}>{sh.name} (about {sh.rows.toLocaleString()} rows)</option>)}
              </select>
            </label>
          </p>
        )}
      </div>

      {status === 'validating' && <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Reading and checking the file…</p>}

      {validationErrors.length > 0 && (
        <div style={{ background: '#fdeaea', border: '1px solid #e88', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <strong style={{ color: 'crimson' }}>Validation failed — nothing was saved:</strong>
          <ul style={{ marginTop: 8, marginBottom: 0 }}>
            {validationErrors.map((err, i) => <li key={i} style={{ color: '#a33', fontSize: 14 }}>{err}</li>)}
          </ul>
          {rawHeaders.length > 0 && (
            <button onClick={() => { setValidationErrors([]); setStatus('mapping'); }} style={{ marginTop: 12, padding: '6px 12px', cursor: 'pointer' }}>
              Change column matching
            </button>
          )}
        </div>
      )}

      {status === 'mapping' && (
        <div style={box}>
          <h3 style={{ marginTop: 0 }}>Match the columns</h3>
          <p style={{ color: '#666', marginTop: 0 }}>
            Pick which of the client&apos;s columns holds each field. * = required.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#666' }}>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>ODYSSEY field</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Client&apos;s column</th>
              </tr>
            </thead>
            <tbody>
              {ALL_FIELDS.map((field) => (
                <tr key={field} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 4px' }}>{FIELD_LABELS[field]}</td>
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={mapping[field] || ''}
                      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                      style={{ padding: 6, width: '100%' }}
                    >
                      <option value="">(none)</option>
                      {rawHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button onClick={suggestMappingWithAI} disabled={aiBusy} style={aiButton}>
              <BusyLabel busy={aiBusy} busyText="Claude is matching…">Ask Claude to match them</BusyLabel>
            </button>
            <button onClick={confirmMapping} disabled={aiBusy} style={{ padding: '8px 14px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Use these columns
            </button>
          </div>
          {mappingByAI && <p style={{ fontSize: 13, color: '#666', marginBottom: 0 }}><ClaudeTag />Claude only suggests. You confirm by clicking Use these columns.</p>}
          {aiMessage && <p style={{ color: '#a70', marginBottom: 0 }}>{aiMessage}</p>}
        </div>
      )}

      {status === 'ready' && (
        <>
          <div style={{ background: '#eaf6ea', border: '1px solid #8c8', padding: 16, borderRadius: 8, marginBottom: 16 }}>
            {saveMessage && <p style={{ color: '#a70', margin: '0 0 8px' }}>{saveMessage}</p>}
            <p style={{ margin: 0, marginBottom: 8 }}>
              <strong>{parsedRows.length} rows</strong> passed validation, and every journal entry balances.
            </p>
            <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
              Optional columns found: {foundOptional.length > 0 ? foundOptional.map((f) => FIELD_LABELS[f]).join(', ') : 'none'}
              {' · '}
              <button onClick={() => setStatus('mapping')} style={{ background: 'none', border: 'none', color: '#3b4cca', cursor: 'pointer', padding: 0 }}>
                change column matching
              </button>
            </p>
          </div>

          <div style={box}>
            <h3 style={{ marginTop: 0 }}>Account types</h3>
            <p style={{ color: '#666', marginTop: 0, fontSize: 14 }}>
              Rules 5 and 6 need to know what kind of account each one is. Check the list, change anything that&apos;s wrong, then save.
              {unclassified > 0 && <strong style={{ color: '#a70' }}> {unclassified} account(s) still have no type.</strong>}
            </p>
            <button onClick={sortAccountsWithAI} disabled={aiBusy} style={{ ...aiButton, marginBottom: 12 }}>
              <BusyLabel busy={aiBusy} busyText="Claude is sorting…">Ask Claude to sort the accounts</BusyLabel>
            </button>
            {aiMessage && <p style={{ color: '#a70', marginTop: 0 }}>{aiMessage}</p>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#666' }}>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>Account title</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>Account type</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>Sorted by</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const v = accountClasses[account];
                  return (
                    <tr key={account} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '6px 4px' }}>{account}</td>
                      <td style={{ padding: '6px 4px' }}>
                        <select
                          value={v.class}
                          onChange={(e) => setAccountClasses({ ...accountClasses, [account]: { class: e.target.value, source: 'Person' } })}
                          style={{ padding: 4 }}
                        >
                          <option value="">(choose)</option>
                          {CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 4px', color: '#666', fontSize: 12 }}>
                        {v.source === 'AI' ? <ClaudeTag text="Claude suggestion" /> : SOURCE_LABELS[v.source]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleConfirmSave}
            disabled={aiBusy || inactive}
            style={{ padding: '10px 20px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', marginBottom: 16 }}
          >
            Confirm &amp; Save to Engagement
          </button>
        </>
      )}

      {status === 'saving' && <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Saving {parsedRows.length.toLocaleString()} lines…</p>}

      {status === 'done' && (
        <div style={{ background: '#eaf6ea', border: '1px solid #8c8', padding: 16, borderRadius: 8 }}>
          <p style={{ margin: 0 }}>{saveMessage}</p>
          <Link href={`/engagements/${engagementId}`} style={{ display: 'inline-block', marginTop: 12 }}>
            &larr; Back to Engagement
          </Link>
        </div>
      )}
    </div>
  );
}
