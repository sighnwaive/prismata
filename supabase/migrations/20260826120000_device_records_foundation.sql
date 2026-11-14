create table if not exists public.device_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  platform text not null default 'unknown',
  device_name text,
  app_instance_id text,
  auth_provider text not null default 'anonymous',
  joystick_subject text,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, device_id)
);

comment on table public.device_records is 'Anonymous-first session/device foundation. Domain sync tables come later.';
