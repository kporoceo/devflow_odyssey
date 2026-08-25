-- =========================================================
-- ODYSSEY MVP SCHEMA
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- =========================================================

-- 1. PROFILES TABLE (extends Supabase's built-in auth.users with a role)
-- Supabase Auth already creates a hidden "auth.users" table when someone
-- signs up. We can't add a "role" column to it directly, so we make our
-- own "profiles" table that links to it 1-to-1.
create table if not exists profiles (
  id uuid references auth.users(id) primary key,
  full_name text,
  role text not null default 'Audit Associate',
  created_at timestamp with time zone default now()
);

-- Allowed roles for now (matches your user classes table).
-- We enforce this with a check constraint so nobody types a typo role.
alter table profiles
  drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in (
    'Managing Partner',
    'Partner',
    'Audit and Assurance Lead',
    'Supervisor',
    'Audit Associate',
    'Accounting Assistant',
    'Legal Consultant',
    'Liaison Officer',
    'Client Representative'
  ));

-- 2. AUTO-CREATE A PROFILE ROW WHEN SOMEONE SIGNS UP
-- Without this, a new user would exist in auth.users but have no role.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'Audit Associate');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3. ENGAGEMENTS TABLE
create table if not exists engagements (
  id uuid default gen_random_uuid() primary key,
  client_name text not null,
  engagement_name text not null,
  status text not null default 'Active',
  created_by uuid references profiles(id),
  created_at timestamp with time zone default now()
);

-- 4. ROW LEVEL SECURITY (RLS)
-- This is Supabase's permission system. By default, once RLS is ON,
-- NOBODY can read/write a table until you write a policy allowing it.
alter table profiles enable row level security;
alter table engagements enable row level security;

-- Anyone logged in can see all profiles (needed to show names/roles in UI)
drop policy if exists "profiles are viewable by authenticated users" on profiles;
create policy "profiles are viewable by authenticated users"
  on profiles for select
  using (auth.role() = 'authenticated');

-- A user can update only their own profile row
drop policy if exists "users can update own profile" on profiles;
create policy "users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Any logged-in user can view all engagements (firm-wide visibility for MVP)
drop policy if exists "engagements viewable by authenticated users" on engagements;
create policy "engagements viewable by authenticated users"
  on engagements for select
  using (auth.role() = 'authenticated');

-- Any logged-in user can create an engagement (tighten this later by role)
drop policy if exists "authenticated users can create engagements" on engagements;
create policy "authenticated users can create engagements"
  on engagements for insert
  with check (auth.role() = 'authenticated');
