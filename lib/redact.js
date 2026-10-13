// Privacy filter for everything ODYSSEY sends to Claude (finals panel, 2026-10-13).
// Runs on the server, inside app/api/ai/route.js, just before the request leaves.
//
// 1. Masks personal and identifying details inside free text (descriptions,
//    account names, comments): TINs, emails, phone numbers, long ID or bank
//    numbers, and the client's own name.
// 2. Replaces preparer names with codes (Preparer A, Preparer B...). Claude's
//    answer is turned back into the real names here on the server, so the
//    auditor still reads real names but Claude never sees them.
// 3. Removes text that tries to give the AI instructions (prompt injection),
//    for example a memo saying "ignore previous instructions".

const RULES = [
  // TIN: 123-456-789 or 123-456-789-000 (with dashes, spaces or nothing)
  [/\b\d{3}[-\s]?\d{3}[-\s]?\d{3}(?:[-\s]?\d{3,5})?\b/g, '[TIN/ID]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  // PH mobile and landline numbers: 0917 123 4567, +63 917 123 4567, (02) 8123 4567
  [/(?:\+?63|0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[PHONE]'],
  [/\(0\d{1,2}\)\s?\d{3,4}[\s-]?\d{4}\b/g, '[PHONE]'],
  // Any other run of 10 or more digits (bank account, card, policy number).
  // Dates like 2026-12-31 have only 8 digits, so they are left alone.
  [/\b\d[\d\s-]{8,}\d\b/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[NUMBER]' : m)],
];

// Phrases that only make sense as orders to an AI, not as accounting memos.
const INJECTION = /(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)|system prompt|you are now|new instructions|instructions?\s*:|<\/?[a-z_]+>|\bassistant\s*:/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeRedactor({ clientName } = {}) {
  const people = new Map(); // real name -> code
  const stats = { masked: 0, injection: 0 };
  const clientRe = clientName && clientName.trim().length >= 3 ? new RegExp(escapeRe(clientName.trim()), 'gi') : null;

  function text(value) {
    let s = String(value ?? '');
    if (!s) return s;
    if (INJECTION.test(s)) { stats.injection += 1; return '[removed: text written like an instruction to the AI]'; }
    const before = s;
    if (clientRe) s = s.replace(clientRe, '[CLIENT]');
    for (const [re, mask] of RULES) s = s.replace(re, mask);
    for (const [name, code] of people) s = s.replace(new RegExp(`\\b${escapeRe(name)}\\b`, 'gi'), code);
    if (s !== before) stats.masked += 1;
    return s;
  }

  function person(name) {
    const n = String(name ?? '').trim();
    if (!n) return '';
    if (!people.has(n)) people.set(n, `Preparer ${String.fromCharCode(65 + (people.size % 26))}${people.size >= 26 ? people.size : ''}`);
    return people.get(n);
  }

  // Put real names back into Claude's answer (on our server, never sent out).
  function restore(value) {
    let s = String(value ?? '');
    // Longest codes first, so "Preparer A1" is not read as "Preparer A".
    const pairs = [...people].sort((x, y) => y[1].length - x[1].length);
    for (const [name, code] of pairs) s = s.split(code).join(name);
    if (clientName) s = s.split('[CLIENT]').join(clientName);
    return s;
  }

  // For the Analytics summary: preparer names can be keys ("amount_by_preparer")
  // or values ("preparer"), so walk the whole object.
  function walk(value, key = '') {
    const isPrep = /prepar|entered_by/i.test(key);
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [isPrep ? person(k) : text(k), walk(v, k)]));
    }
    if (typeof value === 'string') return isPrep ? person(value) : text(value);
    return value;
  }

  return { text, person, restore, walk, stats };
}
