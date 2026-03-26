-- One-time codes for email OTP login. Checked then invalidated on use.
create table public.login_otp (
  id uuid not null default gen_random_uuid(),
  email text not null,
  code text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone null default now(),
  constraint login_otp_pkey primary key (id)
);

create index login_otp_email_expires_idx on public.login_otp (email, expires_at);

comment on table public.login_otp is 'Temporary 6-digit OTPs for passwordless login; single use, time-limited.';
