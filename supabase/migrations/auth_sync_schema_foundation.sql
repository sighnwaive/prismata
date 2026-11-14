create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.users is 'Application-owned users for the Postgres-backed auth and sync architecture.';

create table if not exists public.auth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_subject)
);

comment on table public.auth_accounts is 'Provider identities linked to application users. This is the chosen linked_accounts/auth_accounts table for the PRD schema.';

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.sessions is 'Server-managed application sessions for backend-issued auth.';

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  device_id text not null,
  platform text not null default 'unknown',
  device_name text,
  app_instance_id text,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, device_id)
);

comment on table public.devices is 'PRD-aligned device registry owned by the backend API. This replaces the earlier Supabase-centric device_records naming.';

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id)
);

comment on table public.user_settings is 'Per-user settings snapshot for initial account-backed sync.';
