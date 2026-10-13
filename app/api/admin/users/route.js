// Server-side account management for the System Administrator (Manage Users
// screen). Creating accounts and changing passwords needs Supabase's service
// role key, which must never reach the browser, so this runs on the server only.
// The System Administrator has no access to audit data in the database; this
// route gives them only what the Manage Users screen needs.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';
import { ALL_ROLES, CLIENT_ROLE, SYSTEM_ADMIN, LEADERSHIP } from '../../../../lib/roles';

// Roles that can sign reports or manage accounts. Their passwords must never be
// known by anyone else, so they only get an emailed link (Part M, finals panel).
const PRIVILEGED = [...LEADERSHIP, SYSTEM_ADMIN];

export const dynamic = 'force-dynamic';

// Where the emailed "set your password" link sends people: this same site.
// The address must be in Supabase > Authentication > URL Configuration > Redirect URLs.
function callbackUrl(request) {
  return `${request.headers.get('origin') || new URL(request.url).origin}/auth/callback`;
}

// Supabase's built-in email only reaches the project's own team; anyone else
// needs custom SMTP. Turn its error into something the administrator can act on.
function emailError(error, fallback) {
  const text = error.message || '';
  if (/not authorized|rate limit|smtp|sending/i.test(text)) {
    return `The email couldn't be sent (${text}). Set up custom SMTP in Supabase, or ${fallback}.`;
  }
  return text;
}

// If Supabase made the account but couldn't send the invite, remove that
// half-made account so the administrator can simply try again.
async function removeUnsentInvite(admin, email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const stuck = (data?.users || []).find((u) => u.email === email && !u.last_sign_in_at && !u.email_confirmed_at);
  if (stuck) await admin.auth.admin.deleteUser(stuck.id);
}

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

  // 1. Who is calling? Only an active System Administrator may continue.
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return fail('Please log in again.', 401);

  const { data: caller } = await admin.from('profiles').select('full_name, email, role, is_active').eq('id', user.id).single();
  const body = await request.json();

  // Writes one line to the Account Activity log (read by Firm Leadership).
  async function log(action, target, details = '') {
    await admin.from('admin_activity').insert({
      actor_id: user.id,
      actor_name: caller.full_name || caller.email,
      actor_role: caller.role,
      action,
      target_id: target?.id || null,
      target_name: target?.full_name || null,
      target_email: target?.email || null,
      details,
    });
  }

  // Break-glass: if the System Administrator's account is compromised, the
  // Managing Partner can deactivate it (and only that) from Account Activity.
  if (caller?.is_active && caller.role === 'Managing Partner') {
    if (body.action === 'list_admins') {
      const { data } = await admin.from('profiles').select('id, full_name, email, is_active').eq('role', SYSTEM_ADMIN).order('full_name');
      return NextResponse.json({ admins: data || [] });
    }
    if (body.action === 'set_active') {
      const { data: target } = await admin.from('profiles').select('id, full_name, email, role').eq('id', body.user_id).single();
      if (target?.role !== SYSTEM_ADMIN) return fail('The Managing Partner can only deactivate or reactivate a System Administrator.', 403);
      const active = !!body.is_active;
      const { error } = await admin.auth.admin.updateUserById(target.id, { ban_duration: active ? 'none' : '876000h' });
      if (error) return fail(error.message);
      await admin.from('profiles').update({ is_active: active }).eq('id', target.id);
      await log(active ? 'Reactivated a System Administrator' : 'Deactivated a System Administrator', target);
      return NextResponse.json({ ok: true });
    }
  }

  if (!caller || !caller.is_active || caller.role !== SYSTEM_ADMIN) {
    return fail('Only the System Administrator can manage user accounts.', 403);
  }

  // The list of accounts, plus client names so a client account can be
  // linked to its company. Nothing about the engagements is sent.
  if (body.action === 'list') {
    const { data: users, error } = await admin.from('profiles')
      .select('id, full_name, email, role, is_active, must_change_password, client_id, created_at')
      .order('created_at', { ascending: true });
    if (error) return fail(error.message);
    const { data: clients } = await admin.from('clients')
      .select('id, name')
      .order('name');
    return NextResponse.json({ users: users || [], clients: clients || [] });
  }

  // 2. Create an account. Either Supabase emails the person a link to set their
  //    own password (send_email), or the account gets a default password that
  //    is shown once to the administrator.
  if (body.action === 'create') {
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.full_name || '').trim();
    if (!email || !fullName) return fail('Enter a name and an email.');
    if (!ALL_ROLES.includes(body.role)) return fail('Choose a role.');
    if (body.role === CLIENT_ROLE && !body.client_id) return fail('Choose the client.');
    if (PRIVILEGED.includes(body.role) && !body.send_email) {
      return fail(`A ${body.role} account must get an emailed link to set their own password, so nobody else ever knows it. Tick "Email them a link".`);
    }

    let created;
    let password = null;
    if (body.send_email) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo: callbackUrl(request),
      });
      if (error) {
        if (/already/i.test(error.message)) {
          // Left over from an earlier invite that failed to send? Clear it so the next try works.
          const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
          if (!existing) {
            await removeUnsentInvite(admin, email);
            return fail('An earlier invite for this email never finished. It has been cleared: click Create account again.');
          }
          return fail('An account with this email already exists.');
        }
        await removeUnsentInvite(admin, email);
        return fail(emailError(error, 'untick "Email them a link" to get a default password instead'));
      }
      created = data;
    } else {
      password = defaultPassword();
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // no confirmation email: the firm hands over the login details
        user_metadata: { full_name: fullName },
      });
      if (error) return fail(error.message.includes('already') ? 'An account with this email already exists.' : error.message);
      created = data;
    }

    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      full_name: fullName,
      email,
      role: body.role,
      client_id: body.role === CLIENT_ROLE ? body.client_id : null,
      client_engagement_id: null, // replaced by client_id (Part L)
      must_change_password: true,
      is_active: true,
    });
    if (profileError) return fail(profileError.message);

    await log('Created account', { id: created.user.id, full_name: fullName, email },
      `Role: ${body.role}. ${password ? 'Default password shown to the administrator.' : 'Set-password link emailed.'}`);
    return NextResponse.json(password ? { password } : { emailed: email });
  }

  const userId = body.user_id;
  if (!userId) return fail('No user chosen.');
  const { data: target } = await admin.from('profiles').select('id, full_name, email, role, must_change_password').eq('id', userId).single();
  if (!target) return fail('Account not found.');

  // 3. Change someone's role (and, for clients, which client they belong to).
  if (body.action === 'update') {
    if (userId === user.id) return fail('You can\'t change your own role. Ask another System Administrator.');
    if (!ALL_ROLES.includes(body.role)) return fail('Choose a role.');
    if (body.role === CLIENT_ROLE && !body.client_id) return fail('Choose the client.');
    // An account that still has a default password could be one the administrator
    // knows the password of, so it can't be given a signing or admin role.
    if (PRIVILEGED.includes(body.role) && !PRIVILEGED.includes(target.role) && target.must_change_password) {
      return fail(`${target.full_name || target.email} hasn't set their own password yet, so they can't be made ${body.role}. Ask them to log in and set it first.`);
    }
    const { error } = await admin.from('profiles').update({
      role: body.role,
      client_id: body.role === CLIENT_ROLE ? body.client_id : null,
      client_engagement_id: null, // replaced by client_id (Part L)
    }).eq('id', userId);
    if (error) return fail(error.message);
    await log('Changed role', target, `${target.role} → ${body.role}`);
    return NextResponse.json({ ok: true });
  }

  // 4. Forgotten password: give a new default password; they must change it again.
  if (body.action === 'reset_password') {
    if (PRIVILEGED.includes(target.role)) {
      return fail(`A ${target.role}'s password can only be reset by email, so nobody else ever knows it. Use "Email reset link".`);
    }
    const password = defaultPassword();
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return fail(error.message);
    await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);
    await log('Reset password (default password)', target);
    return NextResponse.json({ password });
  }

  // 4b. Forgotten password, by email: Supabase sends a link to set a new one.
  //     They must still choose a new password if they log in with the old one.
  if (body.action === 'email_reset') {
    if (!target?.email) return fail('This account has no email address.');
    const { error } = await admin.auth.resetPasswordForEmail(target.email, { redirectTo: callbackUrl(request) });
    if (error) return fail(emailError(error, 'click "Reset password" to get a default password instead'));
    await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);
    await log('Emailed reset link', target);
    return NextResponse.json({ emailed: target.email });
  }

  // 5. Deactivate (blocks login) or reactivate an account. Nothing is deleted,
  //    so the audit trail keeps the person's name on their past work.
  if (body.action === 'set_active') {
    if (userId === user.id) return fail('You can\'t deactivate your own account.');
    const active = !!body.is_active;
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
    if (error) return fail(error.message);
    await admin.from('profiles').update({ is_active: active }).eq('id', userId);
    await log(active ? 'Reactivated account' : 'Deactivated account', target);
    return NextResponse.json({ ok: true });
  }

  return fail('Unknown action.');
}
