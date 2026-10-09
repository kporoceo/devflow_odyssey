-- =========================================================
-- ODYSSEY — FINALS: accounts, roles, reports and sign-off
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (Run AFTER schema_finals_je_rules.sql)
-- Safe to run twice.
--
-- Who can do what (from the use case diagram):
--   Firm Leadership  = Managing Partner, Partner: creates all accounts,
--                      reviews testing history, prepares reports, partner sign-off
--   Audit Team       = Audit and Assurance Lead, Audit Associate: the only
--                      ones doing JE testing; the A&A Lead is the report reviewer
--   Operations Team  = Supervisor, Accounting Assistant: prepares reports, no JE testing
--   Client           = Client Representative: views and signs off its own
--                      engagement's reports, nothing else, no uploads
-- =========================================================

-- 1. NEW PROFILE COLUMNS
alter table profiles add column if not exists email text;
alter table profiles add column if not exists must_change_password boolean default false;  -- true until the default password is changed
alter table profiles add column if not exists is_active boolean default true;              -- false = deactivated by Firm Leadership
alter table profiles add column if not exists client_engagement_id uuid references engagements(id) on delete set null; -- clients only
alter table profiles add column if not exists theme text default 'system';                -- 'light', 'dark' or 'system'

update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- New accounts start with the lowest access. The Manage Users screen then
-- sets the real role. Nobody can sign themselves up any more.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role, must_change_password)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, 'Client Representative', true)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- 2. ROLE HELPERS (used by the access rules below)
-- "security definer" lets them read profiles without tripping profiles' own rules.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_firm_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('Managing Partner', 'Partner', 'Audit and Assurance Lead', 'Audit Associate', 'Supervisor', 'Accounting Assistant'), false)
$$;

create or replace function public.is_leadership() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('Managing Partner', 'Partner'), false)
$$;

create or replace function public.is_audit_team() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('Audit and Assurance Lead', 'Audit Associate'), false)
$$;

create or replace function public.can_prepare_reports() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('Managing Partner', 'Partner', 'Supervisor', 'Accounting Assistant'), false)
$$;

create or replace function public.my_client_engagement() returns uuid
language sql stable security definer set search_path = public as $$
  select client_engagement_id from profiles
  where id = auth.uid() and is_active and role = 'Client Representative'
$$;

-- 3. PROFILES: see your own row (firm staff see everyone); edit only your
--    name, theme and the "must change password" switch. Role, email and
--    active status can only be changed by the Manage Users screen (server side).
drop policy if exists "profiles are viewable by authenticated users" on profiles;
drop policy if exists "profiles viewable by self or firm staff" on profiles;
create policy "profiles viewable by self or firm staff"
  on profiles for select
  using (id = auth.uid() or is_firm_staff());

revoke update on profiles from authenticated, anon;
grant update (full_name, theme, must_change_password) on profiles to authenticated;

-- 4. ENGAGEMENTS: firm staff see all; a client sees only its own engagement
drop policy if exists "engagements viewable by authenticated users" on engagements;
drop policy if exists "engagements viewable by firm staff or own client" on engagements;
create policy "engagements viewable by firm staff or own client"
  on engagements for select
  using (is_firm_staff() or id = my_client_engagement());

drop policy if exists "authenticated users can create engagements" on engagements;
drop policy if exists "firm staff can create engagements" on engagements;
create policy "firm staff can create engagements"
  on engagements for insert
  with check (is_firm_staff());

-- 5. JE TESTING DATA: firm staff can read it; only the Audit Team changes it
drop policy if exists "journal entries viewable by authenticated users" on journal_entries;
drop policy if exists "journal entries viewable by firm staff" on journal_entries;
create policy "journal entries viewable by firm staff"
  on journal_entries for select using (is_firm_staff());

drop policy if exists "authenticated users can insert journal entries" on journal_entries;
drop policy if exists "audit team can insert journal entries" on journal_entries;
create policy "audit team can insert journal entries"
  on journal_entries for insert with check (is_audit_team());

drop policy if exists "authenticated users can delete journal entries" on journal_entries;
drop policy if exists "audit team can delete journal entries" on journal_entries;
create policy "audit team can delete journal entries"
  on journal_entries for delete using (is_audit_team());

drop policy if exists "testing criteria viewable by authenticated users" on testing_criteria;
drop policy if exists "testing criteria viewable by firm staff" on testing_criteria;
create policy "testing criteria viewable by firm staff"
  on testing_criteria for select using (is_firm_staff());

drop policy if exists "authenticated users can insert testing criteria" on testing_criteria;
drop policy if exists "audit team can insert testing criteria" on testing_criteria;
create policy "audit team can insert testing criteria"
  on testing_criteria for insert with check (is_audit_team());

drop policy if exists "authenticated users can update testing criteria" on testing_criteria;
drop policy if exists "audit team can update testing criteria" on testing_criteria;
create policy "audit team can update testing criteria"
  on testing_criteria for update using (is_audit_team());

drop policy if exists "test results viewable by authenticated users" on je_test_results;
drop policy if exists "test results viewable by firm staff" on je_test_results;
create policy "test results viewable by firm staff"
  on je_test_results for select using (is_firm_staff());

drop policy if exists "authenticated users can insert test results" on je_test_results;
drop policy if exists "audit team can insert test results" on je_test_results;
create policy "audit team can insert test results"
  on je_test_results for insert with check (is_audit_team());

drop policy if exists "test flags viewable by authenticated users" on je_test_flags;
drop policy if exists "test flags viewable by firm staff" on je_test_flags;
create policy "test flags viewable by firm staff"
  on je_test_flags for select using (is_firm_staff());

drop policy if exists "authenticated users can insert test flags" on je_test_flags;
drop policy if exists "audit team can insert test flags" on je_test_flags;
create policy "audit team can insert test flags"
  on je_test_flags for insert with check (is_audit_team());

-- 6. REPORTS AND SIGN-OFF
-- Flow: Draft -> (preparer submits) For Review -> (A&A Lead approves)
-- For Partner Approval -> (Partner approves) For Client Approval ->
-- (Client approves) Signed Off, which locks the report.
-- Anyone at a level can instead return it with a comment (status Returned),
-- and the preparer fixes and resubmits it.
create table if not exists reports (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade not null,
  title text not null,
  body text default '',
  status text not null default 'Draft'
    check (status in ('Draft', 'For Review', 'For Partner Approval', 'For Client Approval', 'Signed Off', 'Returned')),
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists report_signoffs (
  id uuid default gen_random_uuid() primary key,
  report_id uuid references reports(id) on delete cascade not null,
  level text not null check (level in ('Preparer', 'Reviewer', 'Partner', 'Client')),
  decision text not null check (decision in ('Submitted', 'Approved', 'Returned')),
  signed_by uuid references profiles(id),
  signed_name text not null,   -- the name the person typed as their signature
  comment text,
  signed_at timestamp with time zone default now()
);

alter table reports enable row level security;
alter table report_signoffs enable row level security;

-- Firm staff see every report; a client sees only its engagement's reports
-- once they reach the client level.
drop policy if exists "reports viewable by firm staff or own client" on reports;
create policy "reports viewable by firm staff or own client"
  on reports for select
  using (
    is_firm_staff()
    or (engagement_id = my_client_engagement() and status in ('For Client Approval', 'Signed Off'))
  );

drop policy if exists "preparers can create draft reports" on reports;
create policy "preparers can create draft reports"
  on reports for insert
  with check (can_prepare_reports() and status = 'Draft');

-- Only the text can be edited, and only while Draft or Returned.
-- Status changes go through sign_report() below.
revoke update on reports from authenticated, anon;
grant update (title, body, updated_at) on reports to authenticated;

drop policy if exists "preparers can edit drafts" on reports;
create policy "preparers can edit drafts"
  on reports for update
  using (can_prepare_reports() and status in ('Draft', 'Returned'))
  with check (can_prepare_reports() and status in ('Draft', 'Returned'));

-- Sign-offs are readable by whoever can see the report. Nobody inserts them
-- directly: sign_report() does it after checking the role and the level.
drop policy if exists "signoffs viewable with their report" on report_signoffs;
create policy "signoffs viewable with their report"
  on report_signoffs for select
  using (exists (select 1 from reports r where r.id = report_id));

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
    if v_role is distinct from 'Client Representative' or r.engagement_id is distinct from my_client_engagement() then
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

grant execute on function public.sign_report(uuid, text, text, text) to authenticated;
