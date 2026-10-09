'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { BackLink, Spinner } from '../../components/ui';

function EngagementList({ items }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {items.map((eng) => (
        <Link key={eng.id} href={`/engagements/${eng.id}`} className="link-card">
          <div className="row-between">
            <div>
              <p className="link-card-title">{eng.engagement_name}</p>
              <p className="link-card-text">{eng.client_name}</p>
            </div>
            <span className={eng.status === 'Active' ? 'badge badge-success' : 'badge'}>{eng.status}</span>
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
    <div className="page page-narrow">
      <BackLink href="/dashboard">Back to Dashboard</BackLink>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Engagements</h1>
        </div>
      </div>

      <form onSubmit={handleCreate} className="card" style={{ marginBottom: 40 }}>
        <h2 className="card-title" style={{ marginBottom: 20 }}>Create New Engagement</h2>
        <div className="field">
          <label>Client Name</label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Engagement Name</label>
          <input
            type="text"
            value={engagementName}
            onChange={(e) => setEngagementName(e.target.value)}
            required
            placeholder="e.g. FY2026 Annual Audit"
          />
        </div>
        {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
        <div className="form-actions">
          <button type="submit" className="btn">
            Create Engagement
          </button>
        </div>
      </form>

      <h2 style={{ marginBottom: 16 }}>Active engagements</h2>
      {loading ? (
        <p className="loading" style={{ padding: 0 }}><Spinner /> Loading…</p>
      ) : active.length === 0 ? (
        <p className="muted">No active engagements. Create one above.</p>
      ) : (
        <EngagementList items={active} />
      )}

      {inactive.length > 0 && (
        <details style={{ marginTop: 40 }}>
          <summary style={{ fontWeight: 600 }}>Inactive engagements ({inactive.length})</summary>
          <p className="muted" style={{ fontSize: 14, margin: '12px 0 16px' }}>Read-only: no new uploads or test runs. Firm Leadership can reactivate them.</p>
          <EngagementList items={inactive} />
        </details>
      )}
    </div>
  );
}
