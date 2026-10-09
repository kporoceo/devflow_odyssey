'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { createClient } from '../../../../lib/supabaseClient';
import { groupJournalEntries } from '../../../../lib/jeTesting';

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
  const [parsedRows, setParsedRows] = useState([]);
  const [foundOptional, setFoundOptional] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);
  const [status, setStatus] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setValidationErrors([]);
    setParsedRows([]);
    setFoundOptional([]);
    setSaveMessage('');

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

    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => validateAndPrepare(results.meta.fields || [], results.data),
        error: (err) => {
          setValidationErrors([`Could not read file: ${err.message}`]);
          setStatus('error');
        },
      });
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const workbook = XLSX.read(evt.target.result, { type: 'binary' });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          const fields = rows.length > 0 ? Object.keys(rows[0]) : [];

          validateAndPrepare(fields, rows, workbook.SheetNames.length);
        } catch (err) {
          setValidationErrors([`Could not read Excel file: ${err.message}`]);
          setStatus('error');
        }
      };
      reader.onerror = () => {
        setValidationErrors(['Could not read the file. It may be corrupted.']);
        setStatus('error');
      };
      reader.readAsBinaryString(file);
    }
  }

  function validateAndPrepare(rawHeaders, dataRows, sheetCount = 1) {
    const errors = [];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);

    const missing = REQUIRED_COLUMNS.filter((col) => !normalizedHeaders.includes(col));
    if (missing.length > 0) {
      errors.push(
        `Missing required column(s): ${missing.join(', ')}. Found columns: ${rawHeaders.join(', ') || '(none)'}`
      );
    }

    if (dataRows.length === 0) {
      errors.push('The file has no data rows.');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      setStatus('error');
      return;
    }

    const headerMap = {};
    rawHeaders.forEach((h) => { headerMap[normalizeHeader(h)] = h; });

    // For each optional field, find the first header name the file uses.
    const optionalMap = {};
    Object.entries(OPTIONAL_COLUMNS).forEach(([field, names]) => {
      const found = names.find((n) => headerMap[n] !== undefined);
      if (found) optionalMap[field] = headerMap[found];
    });

    const rowErrors = [];
    const cleanRows = [];

    dataRows.forEach((row, index) => {
      const rowNum = index + 2;
      const cell = (header) => String(row[header] ?? '').trim();
      const dateVal = cell(headerMap['date']);
      const accountVal = cell(headerMap['account']);
      const descVal = cell(headerMap['description']);
      const debitVal = cell(headerMap['debit']).replace(/,/g, '');
      const creditVal = cell(headerMap['credit']).replace(/,/g, '');

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
      if (optionalMap.effective_date && cell(optionalMap.effective_date)) {
        effectiveDate = parseDateCell(cell(optionalMap.effective_date));
        if (!effectiveDate) {
          rowErrors.push(`Row ${rowNum}: invalid effective date ("${cell(optionalMap.effective_date)}")`);
          return;
        }
      }

      cleanRows.push({
        engagement_id: engagementId,
        line_no: index + 1,
        entry_date: entryDate,
        effective_date: effectiveDate,
        account: accountVal,
        description: descVal,
        debit,
        credit,
        entered_by: optionalMap.entered_by ? cell(optionalMap.entered_by) || null : null,
        je_number: optionalMap.je_number ? cell(optionalMap.je_number) || null : null,
        source: optionalMap.source ? cell(optionalMap.source) || null : null,
        account_class: optionalMap.account_class ? cell(optionalMap.account_class) || null : null,
      });
    });

    if (rowErrors.length > 0) {
      setValidationErrors(rowErrors.slice(0, 20).concat(
        rowErrors.length > 20 ? [`...and ${rowErrors.length - 20} more row error(s).`] : []
      ));
      setStatus('error');
      return;
    }

    // Rule 6 integrity check: every journal entry must balance (debits = credits).
    // This is a data error, not a risk flag, so nothing is saved if it fails.
    const balanceErrors = [];
    const hasJeNumbers = cleanRows.every((r) => r.je_number);
    groupJournalEntries(cleanRows).forEach((lines) => {
      const diff = lines.reduce((sum, l) => sum + Math.round((l.debit - l.credit) * 100), 0) / 100;
      if (diff !== 0) {
        balanceErrors.push(hasJeNumbers
          ? `JE ${lines[0].je_number}: debits and credits differ by ${peso(Math.abs(diff))}.`
          : `Rows ${lines[0].line_no + 1} to ${lines[lines.length - 1].line_no + 1}: debits and credits differ by ${peso(Math.abs(diff))}.`);
      }
    });
    if (balanceErrors.length > 0) {
      setValidationErrors(['Some journal entries don\'t balance:'].concat(balanceErrors.slice(0, 20)));
      setStatus('error');
      return;
    }

    if (sheetCount > 1) {
      setSaveMessage(`Note: this file has ${sheetCount} sheets — only the first sheet was read.`);
    }

    setFoundOptional(Object.keys(optionalMap));
    setParsedRows(cleanRows);
    setStatus('ready');
  }

  async function handleConfirmSave() {
    setStatus('saving');
    const { data: { user } } = await supabase.auth.getUser();
    const rowsWithUploader = parsedRows.map((r) => ({ ...r, uploaded_by: user.id }));

    const BATCH_SIZE = 500;
    try {
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

  const OPTIONAL_LABELS = {
    effective_date: 'Effective Date (rule 2)',
    entered_by: 'Prepared By (rule 5)',
    je_number: 'JE No. (rule 6)',
    source: 'Source (rule 7)',
    account_class: 'Account Type (rules 5 and 6)',
  };

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 24 }}>
      <Link href={`/engagements/${engagementId}`} style={{ display: 'inline-block', marginBottom: 16 }}>
        &larr; Back to Engagement
      </Link>
      <h1>Upload JE Data</h1>
      <p style={{ color: '#666' }}>
        Upload a CSV or Excel file of journal entries. Required columns: <strong>Date, Account, Description, Debit, Credit</strong>.
        &quot;Date&quot; is the date the entry was keyed in.
      </p>
      <p style={{ color: '#666', fontSize: 14 }}>
        Optional columns used by the testing rules: <strong>Effective Date, Prepared By, JE No., Source, Account Type</strong>.
      </p>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
        {fileName && <p style={{ color: '#666', marginTop: 8 }}>Selected: {fileName}</p>}
      </div>

      {status === 'validating' && <p>Validating file...</p>}

      {validationErrors.length > 0 && (
        <div style={{ background: '#fdeaea', border: '1px solid #e88', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <strong style={{ color: 'crimson' }}>Validation failed — nothing was saved:</strong>
          <ul style={{ marginTop: 8, marginBottom: 0 }}>
            {validationErrors.map((err, i) => <li key={i} style={{ color: '#a33', fontSize: 14 }}>{err}</li>)}
          </ul>
        </div>
      )}

      {status === 'ready' && (
        <div style={{ background: '#eaf6ea', border: '1px solid #8c8', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          {saveMessage && <p style={{ color: '#a70', margin: '0 0 8px' }}>{saveMessage}</p>}
          <p style={{ margin: 0, marginBottom: 8 }}>
            <strong>{parsedRows.length} rows</strong> passed validation, and every journal entry balances.
          </p>
          <p style={{ margin: 0, marginBottom: 12, fontSize: 14, color: '#555' }}>
            Optional columns found: {foundOptional.length > 0 ? foundOptional.map((f) => OPTIONAL_LABELS[f]).join(', ') : 'none'}
          </p>
          <button
            onClick={handleConfirmSave}
            style={{ padding: '10px 20px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Confirm &amp; Save to Engagement
          </button>
        </div>
      )}

      {status === 'saving' && <p>Saving to database...</p>}

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
