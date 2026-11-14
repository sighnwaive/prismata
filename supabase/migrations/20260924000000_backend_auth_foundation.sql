create table if not exists public.oauth_transactions (
  state text primary key,
  provider text not null,
  platform text not null,
  redirect_uri text not null,
  code_challenge text,
  code_challenge_method text,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists oauth_transactions_expiry_idx on public.oauth_transactions (expires_at);
comment on table public.oauth_transactions is 'Single-use, expiring, provider OAuth transactions. State is never reusable.';
