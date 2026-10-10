'use client';

// Small pieces used on many pages: a spinner for buttons that wait on the
// server or the AI, a password box with a Show button, the password
// strength bar, a back link, and the Claude label for AI buttons.
// Colours and shapes come from app/globals.css (var(--...) and class names).

import { useState } from 'react';
import Link from 'next/link';
import { PASSWORD_RULES, passwordStrength } from '../lib/password';

export function Spinner({ size = 14, color = 'currentColor' }) {
  return (
    <span role="status" aria-label="Loading" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
      <style>{'@keyframes odyssey-spin { to { transform: rotate(360deg); } }'}</style>
      <span style={{
        width: size, height: size, borderRadius: '50%', display: 'inline-block',
        border: `2px solid ${color}`, borderRightColor: 'transparent', opacity: 0.8,
        animation: 'odyssey-spin 0.8s linear infinite',
      }} />
    </span>
  );
}

// A button label that shows a spinner and a waiting text while busy.
export function BusyLabel({ busy, children, busyText }) {
  if (!busy) return children;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Spinner />
      {busyText || 'Working…'}
    </span>
  );
}

export function BackLink({ href, children }) {
  return (
    <Link href={href} className="back-link">
      <span aria-hidden="true">&larr;</span> {children}
    </Link>
  );
}

// Put next to AI buttons and on anything the AI wrote.
export function ClaudeTag({ text = 'Claude' }) {
  return (
    <span
      title="This feature uses Claude, an AI model by Anthropic. A person always checks and confirms the result."
      className="badge badge-gold"
      style={{ marginRight: 6 }}
    >
      <span aria-hidden="true">&#10022;</span> {text}
    </span>
  );
}

export function PasswordInput({ value, onChange, placeholder, autoComplete = 'current-password', required = true, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-pressed={show}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        className="password-eye"
      >
        <EyeIcon off={show} />
      </button>
    </div>
  );
}

// Open eye = "show the password"; crossed-out eye = "hide it again".
function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

// Strength bar plus a checklist of the rules, ticked as they're met.
export function PasswordChecklist({ password }) {
  const strength = passwordStrength(password);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: password && i <= strength.score ? strength.color : 'var(--border)' }} />
        ))}
      </div>
      <p style={{ fontSize: 13, margin: '4px 0', color: strength.color, minHeight: 18 }}>
        {strength.label && `Strength: ${strength.label}`}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
        {PASSWORD_RULES.map((r) => {
          const ok = r.test(password || '');
          return (
            <li key={r.key} style={{ color: ok ? 'var(--success)' : 'var(--text-2)' }}>
              {ok ? '✓' : '○'} {r.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
