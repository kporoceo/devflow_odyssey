'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';

export default function Dashboard() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      // Fetch this user's role from the "profiles" table
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .single();

      if (!error) setProfile({ email: user.email, ...data });
      setLoading(false);
    }
    loadUser();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) return <p style={{ padding: 24 }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>ODYSSEY Dashboard</h1>
        <button onClick={handleLogout} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          Log out
        </button>
      </div>

      <div style={{ background: 'white', padding: 16, borderRadius: 8, marginBottom: 24 }}>
        <p><strong>Name:</strong> {profile?.full_name || '(not set)'}</p>
        <p><strong>Email:</strong> {profile?.email}</p>
        <p><strong>Role:</strong> {profile?.role}</p>
      </div>

      <Link href="/engagements">
        <button style={{ padding: '10px 20px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          View / Create Audit Engagements &rarr;
        </button>
      </Link>
    </div>
  );
}
