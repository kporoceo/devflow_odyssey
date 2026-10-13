'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { BackLink, Spinner } from '../../components/ui';

const NEW_CLIENT = 'new';

// Engagements grouped under their client, A to Z by client name.
function ClientGroups({ items, onAdd }) {
  const groups = {};
  items.forEach((eng) => { (groups[eng.client_id] ||= { name: eng.client_name || '', items: [] }).items.push(eng); });
  const sorted = Object.entries(groups).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return (
    <div className="stack" style={{ gap: 28 }}>
      {sorted.map(([clientId, g]) => (
        <div key={clientId}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              {g.name} <span className="muted small" style={{ fontWeight: 400 }}>· {g.items.length} engagement{g.items.length === 1 ? '' : 's'}</span>
            </h3>
            {onAdd && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAdd(clientId)}>+ Add engagement</button>}
          </div>
          <EngagementList items={g.items} />
        </div>
      ))}
    </div>
  );
}

function EngagementList({ items }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {items.map((eng) => (
        <Link key={eng.id} href={`/engagements/${eng.id}`} className="link-card">
          <div className="row-between">
            <div>
              <p className="link-card-title">{eng.engagement_name}</p>
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
  const [clients, setClients] = useState([]);
  const [clientChoice, setClientChoice] = useState(''); // a client's id, or NEW_CLIENT
  const [clientName, setClientName] = useState('');     // only for a new client
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
    const { data: clientData } = await supabase.from('clients').select('id, name').order('name');
    setClients(clientData || []);
    if (!clientData?.length) setClientChoice(NEW_CLIENT);
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

    // A new client is stored once; if the name is already there, use that client.
    let clientId = clientChoice;
    if (clientChoice === NEW_CLIENT) {
      const name = clientName.trim();
      const existing = clients.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
      if (existing) {
        clientId = existing.id;
      } else {
        const { data: added, error: clientError } = await supabase
          .from('clients').insert({ name, created_by: user.id }).select('id').single();
        if (clientError) {
          setError(clientError.message.includes('clients_name_key') ? 'That client already exists. Choose it from the list.' : clientError.message);
          return;
        }
        clientId = added.id;
      }
    }

    const { error } = await supabase.from('engagements').insert({
      client_id: clientId,
      engagement_name: engagementName.trim(),
      created_by: user.id,
    });

    if (error) {
      setError(error.message);
    } else {
      setClientName('');
      setEngagementName('');
      setClientChoice(clientId);
      loadEngagements();
    }
  }

  // "+ Add engagement" next to a client fills in that client.
  function addFor(clientId) {
    setClientChoice(clientId);
    setError('');
    document.getElementById('engagement-name')?.focus();
  }

  return (
    <div className="page">
      <BackLink href="/dashboard">Back to Dashboard</BackLink>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Engagements</h1>
        </div>
      </div>

      <div className="split">
        <form onSubmit={handleCreate} className="card">
          <h2 className="card-title" style={{ marginBottom: 20 }}>Create New Engagement</h2>
          <div className="field">
            <label>Client</label>
            <select value={clientChoice} onChange={(e) => setClientChoice(e.target.value)} required>
              <option value="" disabled>Choose a client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW_CLIENT}>+ New client</option>
            </select>
          </div>
          {clientChoice === NEW_CLIENT && (
            <div className="field">
              <label>New Client Name</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
              />
              <p className="hint" style={{ margin: '6px 0 0' }}>Each client is stored once. Its next engagements are added by choosing it from the list.</p>
            </div>
          )}
          <div className="field">
            <label>Engagement Name</label>
            <input
              id="engagement-name"
              type="text"
              value={engagementName}
              onChange={(e) => setEngagementName(e.target.value)}
              required
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn">
              Create Engagement
            </button>
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
        </form>
        
        <div className="stack">
          <h2>Active engagements</h2>
          {loading ? (
            <p className="loading" style={{ padding: 0 }}><Spinner /> Loading…</p>
          ) : active.length === 0 ? (
            <p className="muted">No active engagements. Create one with the form.</p>
          ) : (
            <ClientGroups items={active} onAdd={addFor} />
          )}

          {inactive.length > 0 && (
            <details style={{ marginTop: 40 }}>
              <summary style={{ fontWeight: 600 }}>Inactive engagements ({inactive.length})</summary>
              <p className="muted" style={{ fontSize: 14, margin: '12px 0 16px' }}>Read-only: no new uploads or test runs. Firm Leadership can reactivate them.</p>
              <ClientGroups items={inactive} />
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
