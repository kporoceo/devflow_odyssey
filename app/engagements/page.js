'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import { BackLink, Spinner } from '../../components/ui';

const NEW_CLIENT = 'new';

const SORTS = {
  az: { label: 'Client A to Z', compare: (a, b) => a.name.localeCompare(b.name) },
  za: { label: 'Client Z to A', compare: (a, b) => b.name.localeCompare(a.name) },
  newest: { label: 'Newest engagement first', compare: (a, b) => b.latest.localeCompare(a.latest) },
  most: { label: 'Most engagements first', compare: (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name) },
};

// Engagements grouped under their client, newest engagement first in each.
function ClientGroups({ items, sort, onAdd }) {
  const groups = {};
  items.forEach((eng) => {
    const g = (groups[eng.client_id] ||= { name: eng.client_name || '', items: [], latest: '' });
    g.items.push(eng);
    if ((eng.created_at || '') > g.latest) g.latest = eng.created_at || '';
  });
  Object.values(groups).forEach((g) => g.items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
  const sorted = Object.entries(groups).sort((a, b) => SORTS[sort].compare(a[1], b[1]));
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

  // Search, sort and filter for the list on the right.
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('az');
  const [show, setShow] = useState('Active');
  const term = search.trim().toLowerCase();
  const shown = engagements.filter((e) =>
    (show === 'All' || (show === 'Inactive' ? e.status === 'Inactive' : e.status !== 'Inactive'))
    && (!term || (e.client_name || '').toLowerCase().includes(term) || (e.engagement_name || '').toLowerCase().includes(term)));
  const clientCount = new Set(shown.map((e) => e.client_id)).size;

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
          <h2>Engagements</h2>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client or engagement"
              aria-label="Search client or engagement"
              style={{ flex: '1 1 220px', width: 'auto' }}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" style={{ width: 'auto' }}>
              {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
            <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show" style={{ width: 'auto' }}>
              <option value="Active">Active only</option>
              <option value="Inactive">Inactive only</option>
              <option value="All">Active and Inactive</option>
            </select>
          </div>
          {!loading && (
            <p className="muted small" style={{ margin: 0 }}>
              {clientCount} client{clientCount === 1 ? '' : 's'}, {shown.length} engagement{shown.length === 1 ? '' : 's'}
              {show !== 'Active' && ' · Inactive engagements are read-only: no new uploads or test runs. Firm Leadership can reactivate them.'}
            </p>
          )}
          {loading ? (
            <p className="loading" style={{ padding: 0 }}><Spinner /> Loading…</p>
          ) : shown.length === 0 ? (
            <p className="muted">{term ? `No client or engagement matches "${search.trim()}".` : `No ${show === 'All' ? '' : show.toLowerCase() + ' '}engagements. Create one with the form.`}</p>
          ) : (
            <ClientGroups items={shown} sort={sort} onAdd={addFor} />
          )}
        </div>
      </div>
    </div>
  );
}
