-- ============================================================
-- ODYSSEY — FINALS: one client, many engagements
-- ============================================================
-- Run this AFTER schema_finals_sysadmin.sql. Safe to run more than once.
--
-- What it adds:
--   1. CLIENTS: a client is stored once. Each engagement belongs to one
--      client, and a client can have many engagements (FY2025, FY2026, ...).
--   2. CLIENT LOGINS: a Client Representative is linked to the client, so
--      they see the reports of every engagement of that client.
--   3. CRITERIA PER CLIENT: the 7 testing rules are configured once per
--      client. An engagement uses its client's criteria unless the Audit
--      Team saves different ones for that engagement only (an override).
--   4. UPLOAD HISTORY: every upload is recorded (file, sheet, lines, who,
--      when), so an engagement can have many uploads, and an upload can be
--      removed until a saved test run has used it.
--
-- Existing data is moved over automatically: one client per client name,
-- client logins linked to their engagement's client, and the newest
-- criteria of each client become that client's criteria.
-- ============================================================

-- 1. CLIENTS -----------------------------------------------------------
create table if not exists clients (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamp with time zone default now()
);

-- "ABC Corp" and "abc corp " are the same client.
create unique index if not exists clients_name_key on clients (lower(trim(name)));

alter table engagements add column if not exists client_id uuid references clients(id);

-- Existing engagements: one client per distinct client name.
insert into clients (name, created_at)
select distinct on (lower(trim(e.client_name))) trim(e.client_name), e.created_at
from engagements e
where e.client_id is null
  and not exists (select 1 from clients c where lower(trim(c.name)) = lower(trim(e.client_name)))
order by lower(trim(e.client_name)), e.created_at;

update engagements e set client_id = c.id
from clients c
where e.client_id is null and lower(trim(c.name)) = lower(trim(e.client_name));

-- Every new or edited engagement gets its client. client_name is kept as a
-- copy of the client's name so every page that shows it still works. If only
-- a client name is given, the client is found by name or created.
create or replace function public.engagement_client_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is null then
    if coalesce(trim(new.client_name), '') = '' then
      raise exception 'Choose a client.';
    end if;
    select id into new.client_id from clients where lower(trim(name)) = lower(trim(new.client_name));
    if new.client_id is null then
      insert into clients (name, created_by) values (trim(new.client_name), auth.uid())
      returning id into new.client_id;
    end if;
  end if;
  select name into new.client_name from clients where id = new.client_id;
  if new.client_name is null then
    raise exception 'Client not found.';
  end if;
  return new;
end;
$$;

drop trigger if exists engagements_client_sync on engagements;
create trigger engagements_client_sync
  before insert or update of client_id, client_name on engagements
  for each row execute function public.engagement_client_sync();

-- Same spelling everywhere ("bayanihan foods " becomes "Bayanihan Foods").
update engagements e set client_name = c.name
from clients c
where e.client_id = c.id and e.client_name is distinct from c.name;

alter table engagements alter column client_id set not null;
create index if not exists engagements_client_id_idx on engagements (client_id);

-- 2. CLIENT LOGINS -------------------------------------------------------
alter table profiles add column if not exists client_id uuid references clients(id) on delete set null;

update profiles p set client_id = e.client_id
from engagements e
where p.client_id is null and p.client_engagement_id = e.id;

-- The client an active Client Representative belongs to (null for everyone else).
create or replace function public.my_client() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from profiles
  where id = auth.uid() and is_active and role = 'Client Representative'
$$;

-- True when the engagement belongs to the signed-in client's company.
create or replace function public.is_my_client_engagement(p_engagement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select client_id = my_client() from engagements where id = p_engagement_id),
    false)
$$;

alter table clients enable row level security;

drop policy if exists "clients viewable by firm staff or own client" on clients;
create policy "clients viewable by firm staff or own client"
  on clients for select
  using (is_firm_staff() or id = my_client());

drop policy if exists "firm staff can add clients" on clients;
create policy "firm staff can add clients"
  on clients for insert
  with check (is_firm_staff());

-- Every place that used to check "the client's one engagement" now checks
-- "any engagement of the client's company".
drop policy if exists "engagements viewable by firm staff or own client" on engagements;
create policy "engagements viewable by firm staff or own client"
  on engagements for select
  using (is_firm_staff() or client_id = my_client());

drop policy if exists "reports viewable by firm staff or own client" on reports;
create policy "reports viewable by firm staff or own client"
  on reports for select
  using (
    is_firm_staff()
    or (is_my_client_engagement(engagement_id) and status in ('For Client Approval', 'Signed Off'))
  );

drop policy if exists "adjustments viewable by firm staff or own client" on adjusting_entries;
create policy "adjustments viewable by firm staff or own client"
  on adjusting_entries for select
  using (is_firm_staff() or is_my_client_engagement(engagement_id));

create or replace function public.decide_adjustment(
  p_id uuid,
  p_decision text,
  p_comment text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  a adjusting_entries;
begin
  select * into a from adjusting_entries where id = p_id for update;
  if a.id is null then
    raise exception 'Adjusting entry not found.';
  end if;
  if my_role() is distinct from 'Client Representative' or not is_my_client_engagement(a.engagement_id) then
    raise exception 'Only this engagement''s client can accept or reject an adjusting entry.';
  end if;
  if a.status <> 'Proposed' then
    raise exception 'This adjusting entry was already decided.';
  end if;
  if p_decision not in ('Accepted', 'Rejected') then
    raise exception 'Choose Accept or Reject.';
  end if;
  if p_decision = 'Rejected' and coalesce(trim(p_comment), '') = '' then
    raise exception 'Add a comment saying why you are rejecting it.';
  end if;

  update adjusting_entries
  set status = p_decision, client_comment = nullif(trim(coalesce(p_comment, '')), ''),
      decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  return p_decision;
end;
$$;

create or replace function public.sign_report(
  p_report_id uuid,
  p_decision text,
  p_signed_name text,
  p_comment text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  r reports;
  v_role text := my_role();
  v_level text;
  v_next text;
begin
  select * into r from reports where id = p_report_id for update;
  if r.id is null then
    raise exception 'Report not found.';
  end if;
  if coalesce(trim(p_signed_name), '') = '' then
    raise exception 'Type your full name to sign.';
  end if;
  if p_decision not in ('Submitted', 'Approved', 'Returned') then
    raise exception 'Unknown decision.';
  end if;

  if r.status in ('Draft', 'Returned') then
    if not can_prepare_reports() then
      raise exception 'Only Firm Leadership or the Operations Team can submit a report.';
    end if;
    if p_decision <> 'Submitted' then
      raise exception 'A draft can only be submitted for review.';
    end if;
    v_level := 'Preparer';
    v_next := 'For Review';
  elsif r.status = 'For Review' then
    if v_role is distinct from 'Audit and Assurance Lead' then
      raise exception 'Only the Audit and Assurance Lead signs at the review level.';
    end if;
    v_level := 'Reviewer';
  elsif r.status = 'For Partner Approval' then
    if not is_leadership() then
      raise exception 'Only a Partner or the Managing Partner signs at the partner level.';
    end if;
    v_level := 'Partner';
  elsif r.status = 'For Client Approval' then
    if v_role is distinct from 'Client Representative' or not is_my_client_engagement(r.engagement_id) then
      raise exception 'Only this engagement''s client signs at the client level.';
    end if;
    v_level := 'Client';
  else
    raise exception 'This report is signed off and locked.';
  end if;

  if v_level <> 'Preparer' then
    if p_decision = 'Submitted' then
      raise exception 'Choose Approve or Return.';
    elsif p_decision = 'Returned' then
      if coalesce(trim(p_comment), '') = '' then
        raise exception 'Add a comment saying why you are returning it.';
      end if;
      v_next := 'Returned';
    else
      if v_level = 'Client' and exists (
        select 1 from adjusting_entries where engagement_id = r.engagement_id and status = 'Proposed'
      ) then
        raise exception 'Accept or reject every proposed adjusting entry before approving the report.';
      end if;
      v_next := case v_level
        when 'Reviewer' then 'For Partner Approval'
        when 'Partner' then 'For Client Approval'
        else 'Signed Off'
      end;
    end if;
  end if;

  insert into report_signoffs (report_id, level, decision, signed_by, signed_name, comment)
  values (p_report_id, v_level, p_decision, auth.uid(), trim(p_signed_name), nullif(trim(coalesce(p_comment, '')), ''));

  update reports set status = v_next, updated_at = now() where id = p_report_id;
  return v_next;
end;
$$;

grant execute on function public.decide_adjustment(uuid, text, text) to authenticated;
grant execute on function public.sign_report(uuid, text, text, text) to authenticated;

-- Client logins now point at the client, not at one engagement, so deleting
-- an engagement no longer needs to check them.
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
  update profiles set client_engagement_id = null where client_engagement_id = p_id;
  delete from engagements where id = p_id;
  if not found then
    raise exception 'Engagement not found.';
  end if;
end;
$$;

-- 3. CRITERIA PER CLIENT -------------------------------------------------
-- A row with client_id (and no engagement_id) is the client's criteria.
-- A row with engagement_id (and no client_id) is an override for that
-- engagement only. The app reads: engagement override, then client, then
-- the built-in defaults.
alter table testing_criteria add column if not exists client_id uuid references clients(id) on delete cascade;
alter table testing_criteria alter column engagement_id drop not null;

alter table testing_criteria drop constraint if exists testing_criteria_one_owner;
alter table testing_criteria add constraint testing_criteria_one_owner
  check ((engagement_id is null) <> (client_id is null));

create unique index if not exists testing_criteria_client_key
  on testing_criteria (client_id) where engagement_id is null;

-- Existing criteria: each client's most recently saved engagement criteria
-- become the client's criteria...
insert into testing_criteria
select (jsonb_populate_record(null::testing_criteria,
          to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'engagement_id', null, 'client_id', x.client_id))).*
from (
  select distinct on (e.client_id) e.client_id, t.id as criteria_id
  from testing_criteria t
  join engagements e on e.id = t.engagement_id
  order by e.client_id, t.updated_at desc nulls last
) x
join testing_criteria t on t.id = x.criteria_id
where not exists (
  select 1 from testing_criteria c where c.client_id = x.client_id and c.engagement_id is null
);

-- ...and an engagement whose criteria are exactly the same as its client's
-- no longer needs its own copy. Engagements with different settings keep
-- them as an override.
delete from testing_criteria o
using engagements e, testing_criteria c
where o.engagement_id = e.id
  and c.client_id = e.client_id and c.engagement_id is null
  and (to_jsonb(o) - array['id', 'engagement_id', 'client_id', 'updated_at', 'updated_by'])
    = (to_jsonb(c) - array['id', 'engagement_id', 'client_id', 'updated_at', 'updated_by']);

-- The Audit Team can remove an engagement's override, so the engagement
-- goes back to using its client's criteria.
drop policy if exists "audit team can delete testing criteria" on testing_criteria;
create policy "audit team can delete testing criteria"
  on testing_criteria for delete using (is_audit_team());

-- 4. UPLOAD HISTORY ------------------------------------------------------
create table if not exists je_uploads (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade not null,
  file_name text,
  sheet_name text,
  row_count integer default 0,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamp with time zone default now()
);

alter table journal_entries add column if not exists upload_id uuid references je_uploads(id) on delete cascade;
create index if not exists journal_entries_upload_id_idx on journal_entries (upload_id);

-- Entries uploaded before this change: one "Earlier uploads" record per engagement.
insert into je_uploads (engagement_id, file_name, row_count, uploaded_by, uploaded_at)
select j.engagement_id, 'Earlier uploads (before upload history)', count(*),
       (array_agg(j.uploaded_by order by j.created_at))[1], min(j.created_at)
from journal_entries j
where j.upload_id is null
group by j.engagement_id;

update journal_entries j set upload_id = u.id
from je_uploads u
where j.upload_id is null
  and u.engagement_id = j.engagement_id
  and u.file_name = 'Earlier uploads (before upload history)';

alter table je_uploads enable row level security;

drop policy if exists "uploads viewable by firm staff" on je_uploads;
create policy "uploads viewable by firm staff"
  on je_uploads for select using (is_firm_staff());

drop policy if exists "audit team can record uploads" on je_uploads;
create policy "audit team can record uploads"
  on je_uploads for insert
  with check (is_audit_team() and engagement_is_active(engagement_id) and uploaded_by = auth.uid());

-- Removing an upload deletes its entries. It is allowed only until a saved
-- test run has used them; after that the upload is audit evidence.
create or replace function public.remove_upload(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u je_uploads;
begin
  if not is_audit_team() then
    raise exception 'Only the Audit Team can remove an upload.';
  end if;
  select * into u from je_uploads where id = p_id for update;
  if u.id is null then
    raise exception 'Upload not found.';
  end if;
  if not engagement_is_active(u.engagement_id) then
    raise exception 'This engagement is Inactive, so its uploads can''t be changed.';
  end if;
  if exists (select 1 from je_test_results where engagement_id = u.engagement_id and run_at >= u.uploaded_at) then
    raise exception 'A saved test run already used this upload, so it is kept as audit evidence.';
  end if;
  delete from je_uploads where id = p_id;  -- its journal entries go with it
end;
$$;

revoke execute on function public.remove_upload(uuid) from public, anon;
grant execute on function public.remove_upload(uuid) to authenticated;
