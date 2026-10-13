import { DEFAULT_CRITERIA } from './jeTesting';

// Testing criteria are saved once per client. An engagement uses its own
// criteria only if the Audit Team saved an override for it. So the order is:
// the engagement's override, then the client's criteria, then the defaults.
export async function loadCriteria(supabase, engagementId) {
  const { data: eng } = await supabase.from('engagements').select('client_id, client_name').eq('id', engagementId).single();

  const { data: own } = await supabase
    .from('testing_criteria').select('*').eq('engagement_id', engagementId).maybeSingle();

  let client = null;
  if (eng?.client_id) {
    const { data } = await supabase
      .from('testing_criteria').select('*').eq('client_id', eng.client_id).is('engagement_id', null).maybeSingle();
    client = data;
  }

  const row = own || client;
  return {
    criteria: mergeCriteria(row),
    source: own ? 'engagement' : client ? 'client' : 'default',
    own,
    client,
    clientId: eng?.client_id || null,
    clientName: eng?.client_name || '',
  };
}

// Keep only the settings the rules use; fall back to the default for any
// column that is still empty.
export function mergeCriteria(row) {
  const merged = { ...DEFAULT_CRITERIA };
  if (row) {
    Object.keys(DEFAULT_CRITERIA).forEach((key) => {
      if (row[key] !== null && row[key] !== undefined) merged[key] = row[key];
    });
  }
  return merged;
}
