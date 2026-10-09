// Server-side account management for Firm Leadership (Manage Users screen).
// Creating accounts and changing passwords needs Supabase's service role
// key, which must never reach the browser, so this runs on the server only.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';
import { ALL_ROLES, CLIENT_ROLE, LEADERSHIP } from '../../../../lib/roles';

export const dynamic = 'force-dynamic';

function fail(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// e.g. "Ody-7kPq3xMa": easy to read out, no look-alike characters (0/O, 1/l).
function defaultPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[randomInt(chars.length)];
  return `Ody-${s}${randomInt(10)}`;
}

export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail('The server is missing SUPABASE_SERVICE_ROLE_KEY.', 500);
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Who is calling? Only an active Managing Partner or Partner may continue.
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return fail('Please log in again.', 401);

  const { data: caller } = await admin.from('profiles').select('role, is_active').eq('id', user.id).single();
  if (!caller || !caller.is_active || !LEADERSHIP.includes(caller.role)) {
    return fail('Only Firm Leadership can manage user accounts.', 403);
  }

  const body = await request.json();

  // 2. Create an account with a default password, shown once to the creator.
  if (body.action === 'create') {
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.full_name || '').trim();
    if (!email || !fullName) return fail('Enter a name and an email.');
    if (!ALL_ROLES.includes(body.role)) return fail('Choose a role.');
    if (body.role === CLIENT_ROLE && !body.client_engagement_id) return fail('Choose the client\'s engagement.');

    const password = defaultPassword();
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no confirmation email: the firm hands over the login details
      user_metadata: { full_name: fullName },
    });
    if (error) return fail(error.message.includes('already') ? 'An account with this email already exists.' : error.message);

    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      full_name: fullName,
      email,
      role: body.role,
      client_engagement_id: body.role === CLIENT_ROLE ? body.client_engagement_id : null,
      must_change_password: true,
      is_active: true,
    });
    if (profileError) return fail(profileError.message);

    return NextResponse.json({ password });
  }

  const userId = body.user_id;
  if (!userId) return fail('No user chosen.');

  // 3. Change someone's role (and, for clients, their engagement).
  if (body.action === 'update') {
    if (userId === user.id) return fail('You can\'t change your own role. Ask another partner.');
    if (!ALL_ROLES.includes(body.role)) return fail('Choose a role.');
    if (body.role === CLIENT_ROLE && !body.client_engagement_id) return fail('Choose the client\'s engagement.');
    const { error } = await admin.from('profiles').update({
      role: body.role,
      client_engagement_id: body.role === CLIENT_ROLE ? body.client_engagement_id : null,
    }).eq('id', userId);
    if (error) return fail(error.message);
    return NextResponse.json({ ok: true });
  }

  // 4. Forgotten password: give a new default password; they must change it again.
  if (body.action === 'reset_password') {
    const password = defaultPassword();
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return fail(error.message);
    await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);
    return NextResponse.json({ password });
  }

  // 5. Deactivate (blocks login) or reactivate an account. Nothing is deleted,
  //    so the audit trail keeps the person's name on their past work.
  if (body.action === 'set_active') {
    if (userId === user.id) return fail('You can\'t deactivate your own account.');
    const active = !!body.is_active;
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
    if (error) return fail(error.message);
    await admin.from('profiles').update({ is_active: active }).eq('id', userId);
    return NextResponse.json({ ok: true });
  }

  return fail('Unknown action.');
}
