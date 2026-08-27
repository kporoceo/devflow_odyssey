-- =========================================================
-- ODYSSEY — THURSDAY ADDITIONS: JE Testing Engine storage
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (Run AFTER schema.sql and schema_wednesday.sql)
-- =========================================================

-- 1. TEST RUNS — one row per time someone clicks "Run JE Testing"
create table if not exists je_test_results (
  id uuid default gen_random_uuid() primary key,
  engagement_id uuid references engagements(id) on delete cascade not null,
  run_at timestamp with time zone default now(),
  run_by uuid references profiles(id),
  total_entries integer default 0,
  flagged_count integer default 0
);

-- 2. INDIVIDUAL FLAGS — one row per (entry, rule) that got flagged in a run
create table if not exists je_test_flags (
  id uuid default gen_random_uuid() primary key,
  test_result_id uuid references je_test_results(id) on delete cascade not null,
  journal_entry_id uuid references journal_entries(id) on delete cascade not null,
  rule text not null,   -- e.g. 'round_dollar', 'off_hours', 'late_period', 'direct_gl', 'unusual_account'
  reason text,          -- human-readable explanation
  created_at timestamp with time zone default now()
);

-- 3. RLS
alter table je_test_results enable row level security;
alter table je_test_flags enable row level security;

drop policy if exists "test results viewable by authenticated users" on je_test_results;
create policy "test results viewable by authenticated users"
  on je_test_results for select using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can insert test results" on je_test_results;
create policy "authenticated users can insert test results"
  on je_test_results for insert with check (auth.role() = 'authenticated');

drop policy if exists "test flags viewable by authenticated users" on je_test_flags;
create policy "test flags viewable by authenticated users"
  on je_test_flags for select using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can insert test flags" on je_test_flags;
create policy "authenticated users can insert test flags"
  on je_test_flags for insert with check (auth.role() = 'authenticated');
