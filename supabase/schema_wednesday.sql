-- =========================================================
-- ODYSSEY — WEDNESDAY ADDITIONS
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (Run this AFTER schema.sql — it assumes engagements/profiles already exist)
-- =========================================================

-- 1. JOURNAL ENTRIES TABLE
-- Stores each row of uploaded journal-entry data, linked to an engagement.
create table if not exists journal_entries (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade not null,
  entry_date date,
  entry_time time,
  account text,
  description text,
  debit numeric default 0,
  credit numeric default 0,
  entered_by text,
  is_direct_gl boolean default false,
  uploaded_by uuid references profiles(id),
  created_at timestamp with time zone default now()
);

-- 2. TESTING CRITERIA TABLE
-- One row per engagement, holding the configurable thresholds for
-- the 5 JE testing rules from your Scope section.
create table if not exists testing_criteria (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade unique not null,
  round_dollar_threshold numeric default 1000,      -- flag amounts that are round multiples of this
  off_hours_start time default '19:00',             -- postings after this time are "off-hours"
  off_hours_end time default '06:00',                -- postings before this time are "off-hours"
  late_period_days integer default 5,                -- entries within N days of period-end are "late-period"
  flag_direct_gl boolean default true,               -- flag entries marked as direct-to-GL
  flag_unusual_accounts boolean default true,        -- flag entries hitting rarely-used account combos
  updated_at timestamp with time zone default now(),
  updated_by uuid references profiles(id)
);

-- 3. ROW LEVEL SECURITY
alter table journal_entries enable row level security;
alter table testing_criteria enable row level security;

drop policy if exists "journal entries viewable by authenticated users" on journal_entries;
create policy "journal entries viewable by authenticated users"
  on journal_entries for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can insert journal entries" on journal_entries;
create policy "authenticated users can insert journal entries"
  on journal_entries for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated users can delete journal entries" on journal_entries;
create policy "authenticated users can delete journal entries"
  on journal_entries for delete
  using (auth.role() = 'authenticated');

drop policy if exists "testing criteria viewable by authenticated users" on testing_criteria;
create policy "testing criteria viewable by authenticated users"
  on testing_criteria for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can insert testing criteria" on testing_criteria;
create policy "authenticated users can insert testing criteria"
  on testing_criteria for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated users can update testing criteria" on testing_criteria;
create policy "authenticated users can update testing criteria"
  on testing_criteria for update
  using (auth.role() = 'authenticated');
