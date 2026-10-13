// Calls ODYSSEY's AI route (app/api/ai/route.js) from a page.
// Throws an Error with a readable message if the AI is down, so each page
// can show it and carry on without the AI.

export const AI_OFF = 'AI is unavailable right now. You can carry on without it.';

export async function askAI(supabase, action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  // Tell the server which engagement this is, so its privacy filter can mask
  // the client's name (pages under /engagements/<id>/ have it in the address).
  const inAddress = window.location.pathname.match(/\/engagements\/([^/]+)/);
  if (!payload.engagement_id && inAddress) payload = { ...payload, engagement_id: inAddress[1] };
  let res;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e) {
    throw new Error(AI_OFF);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || AI_OFF);
  return json;
}

// Small label shown next to anything the AI wrote, so nobody mistakes it
// for a person's conclusion.
export const AI_BADGE_STYLE = {
  background: '#eef2ff', color: '#3b4cca', padding: '1px 6px', borderRadius: 4, fontSize: 12, marginRight: 6,
};
