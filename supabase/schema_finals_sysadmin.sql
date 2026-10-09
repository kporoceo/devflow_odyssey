-- ODYSSEY finals: the System Administrator role.
-- Run once in Supabase > SQL Editor. Safe to run again.

-- SYSTEM ADMINISTRATOR ---------------------------------------------------
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
