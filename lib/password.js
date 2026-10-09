// ODYSSEY's password rules, used when a person sets their own password and
// when Firm Leadership sets a default password. The server route for new
// accounts checks the same rules (app/api/admin/users/route.js).

export const PASSWORD_EXAMPLE = 'e.g. Ledger#2026';

export const PASSWORD_RULES = [
  { key: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'An uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'A lowercase letter (a–z)', test: (p) => /[a-z]/.test(p) },
  { key: 'number', label: 'A number (0–9)', test: (p) => /[0-9]/.test(p) },
  { key: 'special', label: 'A special character (! @ # $ % and so on)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// Returns the labels of the rules this password doesn't meet yet.
export function missingRules(password) {
  return PASSWORD_RULES.filter((r) => !r.test(password || '')).map((r) => r.label);
}

// 0 to 4, with a word and a colour for the strength bar. Meeting every
// rule gives "Good"; 12 or more characters on top of that gives "Strong".
// Common words and repeated characters are never better than "Weak".
export function passwordStrength(password) {
  const p = password || '';
  if (!p) return { score: 0, label: '', color: 'var(--border)' };
  const met = PASSWORD_RULES.filter((r) => r.test(p)).length; // 0..5
  let score = [0, 0, 1, 2, 3, 3][met];
  if (met === 5 && p.length >= 12) score = 4;
  if (/^(.)\1+$/.test(p) || /password|qwerty|12345|odyssey/i.test(p)) score = Math.min(score, 1);
  const levels = [
    { label: 'Very weak', color: 'var(--danger)' },
    { label: 'Weak', color: 'var(--warning)' },
    { label: 'Fair', color: 'var(--accent-text)' },
    { label: 'Good', color: 'var(--success)' },
    { label: 'Strong', color: 'var(--success)' },
  ];
  return { score, ...levels[score] };
}
