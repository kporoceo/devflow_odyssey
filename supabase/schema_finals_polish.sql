-- ODYSSEY finals: profile pictures, engagement status and the System Administrator.
-- Run once in Supabase > SQL Editor, after the earlier finals files.
-- Safe to run again.

-- 1. PROFILE PICTURES -------------------------------------------------
-- The picture is stored in a Storage bucket called "avatars", in a folder
-- named after the person's user id, so each person can only change their own.
alter table profiles add column if not exists avatar_url text;
grant update (avatar_url) on profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists "avatars: upload own" on storage.objects;
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: replace own" on storage.objects;
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: delete own" on storage.objects;
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: read" on storage.objects;
create policy "avatars: read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

-- 2. ENGAGEMENT STATUS ------------------------------------------------
-- Active or Inactive. Only Firm Leadership changes it. An Inactive
-- engagement is read-only for JE testing: no new uploads or test runs.
create or replace function public.engagement_is_active(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'Active' from engagements where id = p_id), false)
$$;

drop policy if exists "audit team can insert journal entries" on journal_entries;
create policy "audit team can insert journal entries"
  on journal_entries for insert with check (is_audit_team() and engagement_is_active(engagement_id));

drop policy if exists "audit team can insert test results" on je_test_results;
create policy "audit team can insert test results"
  on je_test_results for insert with check (is_audit_team() and engagement_is_active(engagement_id));

create or replace function public.set_engagement_status(p_id uuid, p_status text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_leadership() then
    raise exception 'Only Firm Leadership can change an engagement''s status.';
  end if;
  if p_status not in ('Active', 'Inactive') then
    raise exception 'Choose Active or Inactive.';
  end if;
  update engagements set status = p_status where id = p_id;
  if not found then
    raise exception 'Engagement not found.';
  end if;
  return p_status;
end;
$$;

-- Deleting is only for engagements created by mistake. Once an engagement
-- has uploaded entries, test runs or reports, it is audit evidence and can
-- only be made Inactive.
create or replace function public.delete_engagement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_leadership() then
    raise exception 'Only Firm Leadership can delete an engagement.';
  end if;
  if exists (select 1 from journal_entries where engagement_id = p_id)
     or exists (select 1 from je_test_results where engagement_id = p_id)
     or exists (select 1 from reports where engagement_id = p_id) then
    raise exception 'This engagement has uploaded entries, test runs or reports, so it is kept as audit evidence. Mark it Inactive instead.';
  end if;
  if exists (select 1 from profiles where client_engagement_id = p_id) then
    raise exception 'A client account is linked to this engagement. Change or deactivate that account first.';
  end if;
  delete from engagements where id = p_id;
  if not found then
    raise exception 'Engagement not found.';
  end if;
end;
$$;

revoke execute on function public.set_engagement_status(uuid, text) from public, anon;
revoke execute on function public.delete_engagement(uuid) from public, anon;
grant execute on function public.set_engagement_status(uuid, text) to authenticated;
grant execute on function public.delete_engagement(uuid) to authenticated;

-- 3. SYSTEM ADMINISTRATOR -----------------------------------------------
-- A separate role that manages user accounts and nothing else. It isn't in
-- is_firm_staff(), so every existing access rule already keeps it away from
-- engagements, journal entries, test results, reports and sign-off. The
-- Manage Users screen works through the server route, which checks for this role.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in (
  'Managing Partner', 'Partner',
  'Audit and Assurance Lead', 'Audit Associate',
  'Supervisor', 'Accounting Assistant',
  'Legal Consultant', 'Liaison Officer',
  'Client Representative',
  'System Administrator'
));
