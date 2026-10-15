-- Short-lived, single-use links let the host move a team to a replacement phone
-- without changing its identity, answers, or accumulated score.
create table if not exists public.team_transfers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_transfers_team_idx on public.team_transfers(team_id);
alter table public.team_transfers enable row level security;
revoke all on public.team_transfers from anon, authenticated;
