'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { Spinner } from '../../components/ui';

function EngagementList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((eng) => (
        <Link key={eng.id} href={`/engagements/${eng.id}`}>
          <div style={{ background: 'white', padding: 12, borderRadius: 6, display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
            <div>
              <strong>{eng.engagement_name}</strong>
              <p style={{ margin: 0, color: '#666' }}>{eng.client_name}</p>
            </div>
            <span style={{ alignSelf: 'center', color: eng.status === 'Active' ? '#2a7' : '#888' }}>{eng.status}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function Engagements() {
  const [engagements, setEngagements] = useState([]);
  const [clientName, setClientName] = useState('');
  const [engagementName, setEngagementName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  async function loadEngagements() {
    const { data, error } = await supabase
      .from('engagements')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setEngagements(data);
    setLoading(false);
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      loadEngagements();
    }
    init();
  }, []);

  const active = engagements.filter((e) => e.status !== 'Inactive');
  const inactive = engagements.filter((e) => e.status === 'Inactive');

  async function handleCreate(e) {
    e.preventDefault();
    setError('');

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from('engagements').insert({
      client_name: clientName,
      engagement_name: engagementName,
      created_by: user.id,
    });

    if (error) {
      setError(error.message);
    } else {
      setClientName('');
      setEngagementName('');
      loadEngagements();
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 24 }}>
      <Link href="/dashboard" style={{ display: 'inline-block', marginBottom: 16 }}>&larr; Back to Dashboard</Link>
      <h1>Audit Engagements</h1>

      <form onSubmit={handleCreate} style={{ background: 'white', padding: 16, borderRadius: 8, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Create New Engagement</h3>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Client Name</label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Engagement Name</label>
          <input
            type="text"
            value={engagementName}
            onChange={(e) => setEngagementName(e.target.value)}
            required
            placeholder="e.g. FY2026 Annual Audit"
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          />
        </div>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit" style={{ padding: '8px 16px', background: '#111', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Create Engagement
        </button>
      </form>

      <h3>Active engagements</h3>
      {loading ? (
        <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading…</p>
      ) : active.length === 0 ? (
        <p style={{ color: '#666' }}>No active engagements. Create one above.</p>
      ) : (
        <EngagementList items={active} />
      )}

      {inactive.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Inactive engagements ({inactive.length})</summary>
          <p style={{ color: '#666', fontSize: 14 }}>Read-only: no new uploads or test runs. Firm Leadership can reactivate them.</p>
          <EngagementList items={inactive} />
        </details>
      )}
    </div>
  );
}
