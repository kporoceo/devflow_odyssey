'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { createClient } from '../../../../lib/supabaseClient';

const REQUIRED_COLUMNS = ['date', 'account', 'description', 'debit', 'credit'];

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

function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/\s+/g, '_');
}

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

export default function UploadJEData({ params }) {
  const { id: engagementId } = params;
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
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

    const rowErrors = [];
    const cleanRows = [];

    dataRows.forEach((row, index) => {
      const rowNum = index + 2;
      const dateVal = String(row[headerMap['date']] ?? '').trim();
      const accountVal = String(row[headerMap['account']] ?? '').trim();
      const descVal = String(row[headerMap['description']] ?? '').trim();
      const debitVal = String(row[headerMap['debit']] ?? '').trim();
      const creditVal = String(row[headerMap['credit']] ?? '').trim();

      // Excel sometimes stores dates as serial numbers instead of text.
      // sheet_to_json usually converts date-formatted cells automatically,
      // but this guards against raw numbers slipping through.
      let parsedDate = Date.parse(dateVal);
      if (isNaN(parsedDate) && !isNaN(Number(dateVal)) && dateVal !== '') {
        const excelEpoch = new Date(1899, 11, 30);
        parsedDate = excelEpoch.getTime() + Number(dateVal) * 86400000;
      }

      if (!dateVal || isNaN(parsedDate)) {
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

      cleanRows.push({
        engagement_id: engagementId,
        entry_date: new Date(parsedDate).toISOString().slice(0, 10),
        account: accountVal,
        description: descVal,
        debit,
        credit,
      });
    });

    if (rowErrors.length > 0) {
      setValidationErrors(rowErrors.slice(0, 20).concat(
        rowErrors.length > 20 ? [`...and ${rowErrors.length - 20} more row error(s).`] : []
      ));
      setStatus('error');
      return;
    }

    if (sheetCount > 1) {
      setSaveMessage(`Note: this file has ${sheetCount} sheets — only the first sheet was read.`);
    }

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

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 24 }}>
      <Link href={`/engagements/${engagementId}`} style={{ display: 'inline-block', marginBottom: 16 }}>
        &larr; Back to Engagement
      </Link>
      <h1>Upload JE Data</h1>
      <p style={{ color: '#666' }}>
        Upload a CSV or Excel file of journal entries. Required columns: <strong>Date, Account, Description, Debit, Credit</strong>.
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
          <p style={{ margin: 0, marginBottom: 12 }}>
            <strong>{parsedRows.length} rows</strong> passed validation and are ready to save.
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