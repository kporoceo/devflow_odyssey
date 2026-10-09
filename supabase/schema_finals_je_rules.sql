-- =========================================================
-- ODYSSEY — FINALS: the 7 JE testing criteria
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (Run AFTER schema.sql, schema_wednesday.sql and schema_thursday.sql)
-- Safe to run twice: every change uses "if not exists" / "on conflict".
-- =========================================================

-- 1. NEW JOURNAL ENTRY COLUMNS (all optional, filled at upload when the
--    client's file has the matching column)
alter table journal_entries add column if not exists effective_date date;  -- date the transaction belongs to (rule 2, rule 4)
alter table journal_entries add column if not exists je_number text;       -- groups lines into one journal entry (rule 6)
alter table journal_entries add column if not exists source text;          -- e.g. "Manual Journal" in Xero (rule 7)
alter table journal_entries add column if not exists account_class text;   -- Asset / Liability / Equity / Revenue / Expense (rule 5, rule 6)
alter table journal_entries add column if not exists line_no integer;      -- row order in the uploaded file
-- entered_by (the preparer, rule 5) already exists from schema_wednesday.sql

-- 2. NEW TESTING CRITERIA COLUMNS (one on/off switch + settings per rule)
-- Rule 1: Off-hours posting (weekends + holidays)
alter table testing_criteria add column if not exists flag_off_hours boolean default true;
alter table testing_criteria add column if not exists flag_weekends boolean default true;          -- turn off for clients that work weekends (retail, BPO)
-- Rule 2: Posting lag (entry date vs effective date)
alter table testing_criteria add column if not exists flag_posting_lag boolean default true;
alter table testing_criteria add column if not exists max_posting_lag_days integer default 60;
-- Rule 3: Round-peso amounts
alter table testing_criteria add column if not exists flag_round boolean default true;
alter table testing_criteria add column if not exists materiality numeric;                         -- overall materiality, entered by the auditor
alter table testing_criteria add column if not exists round_min_amount numeric default 0;         -- clearly trivial threshold (about 5% of materiality)
alter table testing_criteria add column if not exists round_multiple numeric default 1000;        -- "round" = exact multiple of this
-- Rule 4: Late-period adjustments
alter table testing_criteria add column if not exists flag_late_period boolean default true;
alter table testing_criteria add column if not exists period_end text default '12-31';            -- MM-DD, change for fiscal-year clients
alter table testing_criteria add column if not exists late_days_before integer default 5;
alter table testing_criteria add column if not exists late_days_after integer default 5;
-- Rule 5: Segregation of duties
alter table testing_criteria add column if not exists flag_sod boolean default true;
alter table testing_criteria add column if not exists preparer_roster text default '';            -- one line per person: "Name: Expense, Liability"
alter table testing_criteria add column if not exists sod_rare_pct numeric default 1;             -- no roster: flag preparers below this % of entries
-- Rule 6: Unusual account combinations (flag_unusual_accounts already exists)
alter table testing_criteria add column if not exists combo_min_count integer default 3;
alter table testing_criteria add column if not exists combo_rare_pct numeric default 1;
-- Rule 7: Manual / direct GL entries (flag_direct_gl already exists)
alter table testing_criteria add column if not exists manual_source_keywords text default 'manual journal, journal entry, general journal';

-- 3. HOLIDAY CALENDAR (firm-wide, updated every year from the proclamation)
create table if not exists holidays (
  holiday_date date primary key,
  name text not null,
  kind text   -- 'Regular', 'Special non-working', 'Additional special'
);

alter table holidays enable row level security;

drop policy if exists "holidays viewable by authenticated users" on holidays;
create policy "holidays viewable by authenticated users"
  on holidays for select using (auth.role() = 'authenticated');

-- 2026 holidays, Proclamation No. 1006.
-- Eid'l Fitr and Eid'l Adha are proclaimed separately: add them when announced.
-- Feb 25, 2026 (EDSA) is a special WORKING day, so it is not listed.
insert into holidays (holiday_date, name, kind) values
  ('2026-01-01', 'New Year''s Day', 'Regular'),
  ('2026-02-17', 'Chinese New Year', 'Additional special'),
  ('2026-04-02', 'Maundy Thursday', 'Regular'),
  ('2026-04-03', 'Good Friday', 'Regular'),
  ('2026-04-04', 'Black Saturday', 'Additional special'),
  ('2026-04-09', 'Araw ng Kagitingan', 'Regular'),
  ('2026-05-01', 'Labor Day', 'Regular'),
  ('2026-06-12', 'Independence Day', 'Regular'),
  ('2026-08-21', 'Ninoy Aquino Day', 'Special non-working'),
  ('2026-08-31', 'National Heroes Day', 'Regular'),
  ('2026-11-01', 'All Saints'' Day', 'Special non-working'),
  ('2026-11-02', 'All Souls'' Day', 'Additional special'),
  ('2026-11-30', 'Bonifacio Day', 'Regular'),
  ('2026-12-08', 'Feast of the Immaculate Conception', 'Special non-working'),
  ('2026-12-24', 'Christmas Eve', 'Additional special'),
  ('2026-12-25', 'Christmas Day', 'Regular'),
  ('2026-12-30', 'Rizal Day', 'Regular'),
  ('2026-12-31', 'Last Day of the Year', 'Special non-working')
on conflict (holiday_date) do nothing;
