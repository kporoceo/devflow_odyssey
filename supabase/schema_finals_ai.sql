-- =========================================================
-- ODYSSEY — FINALS: AI functions (part 3)
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (Run AFTER schema_finals_accounts.sql)
-- Safe to run twice.
--
-- The AI only ever SUGGESTS. Nothing here is written by the AI: every row
-- below is saved by a person who confirmed or edited the suggestion.
--   column_maps        which client column is Date, Account, Debit... (UC-13)
--   account_classes    Asset / Liability / Equity / Revenue / Expense per account (UC-12)
--   flag_reviews       the auditor's decision and comment on a flag
--   adjusting_entries  proposed corrections the client accepts or rejects (UC-14)
-- =========================================================

-- 1. COLUMN MAPS: saved once per client, reused on the next upload
create table if not exists column_maps (
  client_name text primary key,
  map jsonb not null,            -- e.g. {"date": "Posting Date", "account": "GL Account", ...}
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamp with time zone default now()
);

-- 2. ACCOUNT CLASSES: one row per account per engagement
create table if not exists account_classes (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade not null,
  account text not null,
  class text not null check (class in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense', 'Suspense')),
  source text not null default 'Person' check (source in ('File', 'AI', 'Guess', 'Person')), -- where the suggestion came from
  confirmed_by uuid references profiles(id) default auth.uid(),
  updated_at timestamp with time zone default now(),
  unique (engagement_id, account)
);

-- 3. FLAG REVIEWS: the auditor's decision on each flagged line.
--    The AI may draft the comment, but only a person picks the decision.
create table if not exists flag_reviews (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade not null,
  journal_entry_id uuid references journal_entries(id) on delete cascade not null,
  disposition text not null check (disposition in ('Explained', 'Error', 'Escalate')),
  comment text not null check (length(trim(comment)) > 0),
  ai_drafted boolean default false,   -- true if the comment started as an AI draft
  reviewed_by uuid references profiles(id) default auth.uid(),
  reviewed_at timestamp with time zone default now(),
  unique (engagement_id, journal_entry_id)
);

-- 4. ADJUSTING ENTRIES: proposed by the Audit Team, decided by the client
create or replace function public.lines_balance(p_lines jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p_lines) = 'array'
     and jsonb_array_length(p_lines) >= 2
     and (select round(sum(coalesce((l->>'debit')::numeric, 0) - coalesce((l->>'credit')::numeric, 0)), 2)
          from jsonb_array_elements(p_lines) l) = 0
$$;

create table if not exists adjusting_entries (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade not null,
  journal_entry_id uuid references journal_entries(id) on delete set null, -- the flagged line it corrects
  description text not null,          -- "To correct ..."
  lines jsonb not null check (lines_balance(lines)), -- [{"account": "...", "debit": 0, "credit": 0}, ...]
  status text not null default 'Proposed' check (status in ('Proposed', 'Accepted', 'Rejected')),
  ai_drafted boolean default false,
  proposed_by uuid references profiles(id) default auth.uid(),
  proposed_at timestamp with time zone default now(),
  client_comment text,
  decided_by uuid references profiles(id),
  decided_at timestamp with time zone
);

-- 5. ACCESS RULES
alter table column_maps enable row level security;
alter table account_classes enable row level security;
alter table flag_reviews enable row level security;
alter table adjusting_entries enable row level security;

-- Column maps and account classes: firm staff read, Audit Team writes.
drop policy if exists "column maps viewable by firm staff" on column_maps;
create policy "column maps viewable by firm staff" on column_maps for select using (is_firm_staff());
drop policy if exists "audit team can insert column maps" on column_maps;
create policy "audit team can insert column maps" on column_maps for insert with check (is_audit_team());
drop policy if exists "audit team can update column maps" on column_maps;
create policy "audit team can update column maps" on column_maps for update using (is_audit_team());

drop policy if exists "account classes viewable by firm staff" on account_classes;
create policy "account classes viewable by firm staff" on account_classes for select using (is_firm_staff());
drop policy if exists "audit team can insert account classes" on account_classes;
create policy "audit team can insert account classes" on account_classes for insert with check (is_audit_team());
drop policy if exists "audit team can update account classes" on account_classes;
create policy "audit team can update account classes" on account_classes for update using (is_audit_team());

-- Flag reviews: firm staff read, Audit Team writes.
drop policy if exists "flag reviews viewable by firm staff" on flag_reviews;
create policy "flag reviews viewable by firm staff" on flag_reviews for select using (is_firm_staff());
drop policy if exists "audit team can insert flag reviews" on flag_reviews;
create policy "audit team can insert flag reviews" on flag_reviews for insert with check (is_audit_team());
drop policy if exists "audit team can update flag reviews" on flag_reviews;
create policy "audit team can update flag reviews" on flag_reviews for update using (is_audit_team());

-- Adjusting entries: firm staff see all; a client sees its own engagement's.
-- The Audit Team proposes and can edit or withdraw while still Proposed.
-- The client decides only through decide_adjustment() below.
drop policy if exists "adjustments viewable by firm staff or own client" on adjusting_entries;
create policy "adjustments viewable by firm staff or own client"
  on adjusting_entries for select
  using (is_firm_staff() or engagement_id = my_client_engagement());

drop policy if exists "audit team can propose adjustments" on adjusting_entries;
create policy "audit team can propose adjustments"
  on adjusting_entries for insert
  with check (is_audit_team() and status = 'Proposed');

revoke update on adjusting_entries from authenticated, anon;
grant update (description, lines) on adjusting_entries to authenticated;

drop policy if exists "audit team can edit proposed adjustments" on adjusting_entries;
create policy "audit team can edit proposed adjustments"
  on adjusting_entries for update
  using (is_audit_team() and status = 'Proposed')
  with check (is_audit_team() and status = 'Proposed');

drop policy if exists "audit team can withdraw proposed adjustments" on adjusting_entries;
create policy "audit team can withdraw proposed adjustments"
  on adjusting_entries for delete
  using (is_audit_team() and status = 'Proposed');

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
  if my_role() is distinct from 'Client Representative' or a.engagement_id is distinct from my_client_engagement() then
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

grant execute on function public.decide_adjustment(uuid, text, text) to authenticated;

-- 6. SIGN-OFF: same as before, plus one check. The client can't approve a
--    report while an adjusting entry for its engagement is still undecided.
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

grant execute on function public.sign_report(uuid, text, text, text) to authenticated;
