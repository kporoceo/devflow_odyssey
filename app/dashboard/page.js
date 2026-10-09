'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { useProfile } from '../../components/AppShell';
import { teamOf, isLeadership, isAuditTeam, SIGNOFF_LEVELS } from '../../lib/roles';

export default function Dashboard() {
  const { profile } = useProfile();
  const [counts, setCounts] = useState({ engagements: 0, waiting: 0 });
  const supabase = createClient();

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const { count: engagements } = await supabase.from('engagements').select('*', { count: 'exact', head: true });

      // Reports sitting at a sign-off level this person can act on.
      const myStatuses = SIGNOFF_LEVELS.filter((s) => s.canAct(profile.role)).map((s) => s.status);
      let waiting = 0;
      if (myStatuses.length > 0) {
        const { count } = await supabase.from('reports').select('*', { count: 'exact', head: true }).in('status', myStatuses);
        waiting = count || 0;
      }
      setCounts({ engagements: engagements || 0, waiting });
    }
    load();
  }, [profile]);

  if (!profile) return null;

  const card = { background: 'white', padding: 20, borderRadius: 8, textDecoration: 'none', color: 'inherit', display: 'block' };

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Welcome, {profile.full_name || profile.email}</h1>
      <p style={{ color: '#666', marginTop: 0 }}>{profile.role} · {teamOf(profile.role)}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 24 }}>
        <Link href="/engagements" style={card}>
          <div style={{ fontSize: 32, fontWeight: 'bold' }}>{counts.engagements}</div>
          <div style={{ color: '#666' }}>Engagements</div>
        </Link>
        <Link href="/reports?waiting=1" style={card}>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: counts.waiting > 0 ? '#c60' : 'inherit' }}>{counts.waiting}</div>
          <div style={{ color: '#666' }}>Reports waiting for you</div>
        </Link>
        {isLeadership(profile.role) && (
          <Link href="/admin/users" style={card}>
            <div style={{ fontSize: 20, fontWeight: 'bold' }}>Manage Users</div>
            <div style={{ color: '#666' }}>Create accounts and set roles</div>
          </Link>
        )}
      </div>

      <p style={{ color: '#666', marginTop: 24 }}>
        {isAuditTeam(profile.role)
          ? 'Open an engagement to upload JE data, set the testing criteria and run JE testing.'
          : 'Open an engagement to see its testing history and reports.'}
      </p>
    </div>
  );
}
