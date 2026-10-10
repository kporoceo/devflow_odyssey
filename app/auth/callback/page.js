'use client';

// Where the "Set your ODYSSEY password" email links land. Supabase sends the
// person here with a one-time sign-in in the address; this page signs them in
// with it and sends them to the Set your own password screen. The link works
// once and expires (24 hours by default in Supabase).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabaseClient';
import { Spinner } from '../../../components/ui';

export default function AuthCallback() {
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    // Read the link before anything else can tidy up the address bar.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);

    async function signIn() {
      const linkError = hash.get('error_description') || query.get('error_description');
      if (linkError) return { error: { message: linkError } };
      // 1. Most Supabase emails: the sign-in is after the # in the link.
      if (hash.get('access_token') && hash.get('refresh_token')) {
        return supabase.auth.setSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') });
      }
      // 2. An email template that links with ?token_hash=...&type=...
      if (query.get('token_hash') && query.get('type')) {
        return supabase.auth.verifyOtp({ token_hash: query.get('token_hash'), type: query.get('type') });
      }
      // 3. A link with ?code=...
      if (query.get('code')) return supabase.auth.exchangeCodeForSession(query.get('code'));
      return { error: { message: 'This link is missing its sign-in details.' } };
    }

    signIn().then(({ error: signInError }) => {
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.replace('/change-password');
    });
  }, []);

  return (
    <div className="auth-page">
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="auth-card">
          {error ? (
            <>
              <h1 className="page-title" style={{ fontSize: 20 }}>This link didn&apos;t work</h1>
              <p className="alert alert-danger">{error}</p>
              <p className="text-2">
                Email links work once and expire after a while. Ask ODCC&apos;s System Admin to send a new one.
              </p>
              <Link href="/login" className="btn btn-block">Go to sign in</Link>
            </>
          ) : (
            <p className="loading" style={{ padding: 0 }}><Spinner /> Signing you in…</p>
          )}
        </div>
      </div>
    </div>
  );
}
