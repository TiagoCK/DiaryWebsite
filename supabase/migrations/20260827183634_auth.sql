-- Authentication: per-user roles.
--
-- Users are created only in Supabase -> Authentication -> Users. The app has no
-- sign-up path, and sign-ups are also disabled in the dashboard
-- (Authentication -> Sign In / Providers -> Email -> "Allow new users to sign
-- up" OFF) -- the anon key ships to every browser, so with that toggle on
-- anyone holding it can call signUp() regardless of what the UI offers.
--
-- Safe to re-run.
--
-- NOTE: there is deliberately no trigger on auth.users here.
-- An earlier version of this migration tried `create trigger on auth.users` to
-- auto-create profile rows. Supabase restricts DDL on the auth schema, so that
-- statement failed while the statements before it committed -- leaving the table
-- created, no trigger, and no backfill. Rather than depend on privileges we
-- don't have, the application creates a missing profile on first sight
-- (src/lib/auth.js) and the admin page can assign roles to any auth user
-- directly (src/app/admin/actions.js).

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'reader',
  created_at timestamptz not null default now(),

  constraint profiles_role_valid check (role in ('reader', 'admin'))
);

-- Same posture as `pages`: RLS on, no policies. All access is server-side with
-- the service-role key, which bypasses RLS. The browser now carries a Supabase
-- client for the login form, authenticated with the public anon key -- this is
-- what stops that client from reading anyone's role.
alter table profiles enable row level security;
