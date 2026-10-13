-- ODYSSEY Part M: answers to the finals panel's security comments (2026-10-13).
-- Run once in Supabase > SQL Editor, after Part L.

-- 1. UPLOAD INTEGRITY ------------------------------------------------------
-- Each upload keeps the file's SHA-256 fingerprint and its debit and credit
-- totals, so the firm can prove later which file was tested and that nothing
-- was added or lost on the way in.
alter table je_uploads add column if not exists file_sha256 text;
alter table je_uploads add column if not exists total_debit numeric(18,2);
alter table je_uploads add column if not exists total_credit numeric(18,2);

-- The same file can't be uploaded twice to one engagement (its entries would be counted twice).
create unique index if not exists je_uploads_same_file_once
  on je_uploads (engagement_id, file_sha256) where file_sha256 is not null;

-- Journal entries can't be edited (there has never been an update rule), and
-- now they can't be deleted one by one either. The only way to remove entries
-- is remove_upload(), which refuses once a saved test run has used them.
drop policy if exists "audit team can delete journal entries" on journal_entries;

-- 2. ACCOUNT ACTIVITY LOG ----------------------------------------------------
-- Every action of the System Administrator (and of a Managing Partner who
-- deactivates an administrator) is written here by the server. Nobody can
-- edit or delete it from the app; Firm Leadership can read it.
create table if not exists admin_activity (
  id uuid default gen_random_uuid() primary key,
  at timestamp with time zone default now() not null,
  actor_id uuid references profiles(id),
  actor_name text,
  actor_role text,
  action text not null,
  target_id uuid,
  target_name text,
  target_email text,
  details text
);
create index if not exists admin_activity_at_idx on admin_activity (at desc);

alter table admin_activity enable row level security;

drop policy if exists "leadership can read account activity" on admin_activity;
create policy "leadership can read account activity"
  on admin_activity for select using (is_leadership());
-- No insert, update or delete rules: only the server (service role key) writes it.
