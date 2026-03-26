-- Allow-list of users who can sign in. No self-registration; only admin-inserted rows.
create table public.users (
  id uuid not null default gen_random_uuid(),
  display_name text not null,
  email text not null,
  needs_password_reset boolean not null default true,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamp with time zone null default now(),
  constraint users_pkey primary key (id),
  constraint users_email_key unique (email)
);

comment on table public.users is 'Allow-list for passwordless OTP login; only these emails can receive a code.';
