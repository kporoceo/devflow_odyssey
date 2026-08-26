'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import { createClient } from '../../../../lib/supabaseClient';

// These are the columns we require in the uploaded CSV.
// Matching is case-insensitive and ignores extra spaces.
const REQUIRED_COLUMNS = ['date', 'account', 'description', 'debit', 'credit'];

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

export default function UploadJEData({ params }) {
  const { id: engagementId } = params;
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);
  const [status, setStatus] = useState(''); // '', 'validating', 'ready', 'saving', 'done', 'error'
  const [saveMessage, setSaveMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setStatus('validating');
    setValidationErrors([]);
    setParsedRows([]);
    setSaveMessage('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        validateAndPrepare(results);
      },
      error: (err) => {
        setValidationErrors([`Could not read file: ${err.message}`]);
        setStatus('error');
      },
    });
  }

  function validateAndPrepare(results) {
    const errors = [];
    const rawHeaders = results.meta.fields || [];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);

    // --- Check 1: required columns present ---
    const missing = REQUIRED_COLUMNS.filter((col) => !normalizedHeaders.includes(col));
    if (missing.length > 0) {
      errors.push(
        `Missing required column(s): ${missing.join(', ')}. Found columns: ${rawHeaders.join(', ') || '(none)'}`
      );
    }

    // --- Check 2: file isn't empty ---
    if (results.data.length === 0) {
      errors.push('The file has no data rows.');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      setStatus('error');
      return;
    }

    // Build a lookup from normalized header -> original header, so we can
    // read values regardless of exact casing/spacing in the uploaded file.
    const headerMap = {};
    rawHeaders.forEach((h) => { headerMap[normalizeHeader(h)] = h; });

    // --- Check 3: validate each row's data types ---
    const rowErrors = [];
    const cleanRows = [];

    results.data.forEach((row, index) => {
      const rowNum = index + 2; // +2 accounts for header row + 0-index
      const dateVal = row[headerMap['date']]?.trim();
      const accountVal = row[headerMap['account']]?.trim();
      const descVal = row[headerMap['description']]?.trim();
      const debitVal = row[headerMap['debit']]?.trim();
      const creditVal = row[headerMap['credit']]?.trim();

      if (!dateVal || isNaN(Date.parse(dateVal))) {
        rowErrors.push(`Row ${rowNum}: invalid or missing date ("${dateVal || ''}")`);
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
        entry_date: new Date(dateVal).toISOString().slice(0, 10),
        account: accountVal,
        description: descVal || '',
        debit,
        credit,
      });
    });

    // Cap how many row-level errors we show so the screen doesn't explode
    // on a huge malformed file.
    if (rowErrors.length > 0) {
      setValidationErrors(rowErrors.slice(0, 20).concat(
        rowErrors.length > 20 ? [`...and ${rowErrors.length - 20} more row error(s).`] : []
      ));
      setStatus('error');
      return;
    }

    setParsedRows(cleanRows);
    setStatus('ready');
  }

  async function handleConfirmSave() {
    setStatus('saving');
    const { data: { user } } = await supabase.auth.getUser();

    const rowsWithUploader = parsedRows.map((r) => ({ ...r, uploaded_by: user.id }));

    // Insert in batches of 500 — Supabase/Postgres handles large single inserts
    // fine, but batching keeps payload size safe for bigger files.
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
        Upload a CSV file of journal entries. Required columns: <strong>Date, Account, Description, Debit, Credit</strong>.
      </p>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 16 }}>
        <input type="file" accept=".csv" onChange={handleFileChange} />
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
