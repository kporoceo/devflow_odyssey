'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabaseClient';
import { useProfile } from '../../../components/AppShell';
import { isAuditTeam, isLeadership } from '../../../lib/roles';

export default function EngagementDetail({ params }) {
  const { id } = params;
  const { profile } = useProfile();
  const [engagement, setEngagement] = useState(null);
  const [entryCount, setEntryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: eng, error } = await supabase
        .from('engagements')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !eng) {
        router.push('/engagements');
        return;
      }
      setEngagement(eng);

      // count() is a lightweight way to get row totals without fetching all rows
      const { count } = await supabase
        .from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('engagement_id', id);

      setEntryCount(count || 0);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading || !profile) return <p style={{ padding: 24 }}>Loading...</p>;

  // Each card is shown only to the roles allowed to use it (the database
  // enforces the same rules).
  const auditTeam = isAuditTeam(profile.role);
  const cards = [
    auditTeam && { href: `/engagements/${id}/upload`, title: 'Upload JE Data', text: entryCount > 0 ? `${entryCount} entries uploaded` : 'No entries yet' },
    auditTeam && { href: `/engagements/${id}/criteria`, title: 'Configure Testing Criteria', text: 'Set the parameters for the 7 JE testing rules' },
    auditTeam && { href: `/engagements/${id}/testing`, title: 'Run JE Testing', text: 'Run the 7 rules against every uploaded entry' },
    (auditTeam || isLeadership(profile.role)) && { href: `/engagements/${id}/history`, title: 'Testing History & Audit Trail', text: 'Review past runs, who ran them, and what was flagged' },
    { href: `/reports?engagement=${id}`, title: 'Reports & Sign-off', text: 'Prepare reports and follow their sign-off' },
  ].filter(Boolean);

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 24 }}>
      <Link href="/engagements" style={{ display: 'inline-block', marginBottom: 16 }}>&larr; Back to Engagements</Link>

      <div style={{ background: 'white', padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <h1 style={{ marginBottom: 4 }}>{engagement.engagement_name}</h1>
        <p style={{ color: '#666', marginTop: 0 }}>{engagement.client_name}</p>
        <p style={{ display: 'inline-block', padding: '4px 10px', background: '#e8f5ee', color: '#2a7', borderRadius: 4, fontSize: 14 }}>
          {engagement.status}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href}>
            <div style={{ background: 'white', padding: 20, borderRadius: 8, cursor: 'pointer', height: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ marginTop: 0 }}>{c.title}</h3>
              <p style={{ color: '#666', margin: 0 }}>{c.text}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
