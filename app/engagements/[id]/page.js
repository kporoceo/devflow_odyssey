'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabaseClient';

export default function EngagementDetail({ params }) {
  const { id } = params;
  const [engagement, setEngagement] = useState(null);
  const [entryCount, setEntryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

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

  if (loading) return <p style={{ padding: 24 }}>Loading...</p>;

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
        <Link href={`/engagements/${id}/upload`}>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, cursor: 'pointer' }}>
            <h3 style={{ marginTop: 0 }}>Upload JE Data</h3>
            <p style={{ color: '#666', margin: 0 }}>
              {entryCount > 0 ? `${entryCount} entries uploaded` : 'No entries yet'}
            </p>
          </div>
        </Link>

        <Link href={`/engagements/${id}/criteria`}>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, cursor: 'pointer' }}>
            <h3 style={{ marginTop: 0 }}>Configure Testing Criteria</h3>
            <p style={{ color: '#666', margin: 0 }}>Set thresholds for the 5 JE testing rules</p>
          </div>
        </Link>

        <Link href={`/engagements/${id}/testing`}>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, cursor: 'pointer', gridColumn: '1 / -1' }}>
            <h3 style={{ marginTop: 0 }}>Run JE Testing</h3>
            <p style={{ color: '#666', margin: 0 }}>Run the 5 automated tests against uploaded entries</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
