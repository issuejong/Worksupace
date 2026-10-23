alter table public.typing_runs add column if not exists last_resumed_at timestamptz;
alter table public.runs add column if not exists round_results_pending boolean not null default false;

-- Only an opaque change notification is public. Game records stay private.
create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists game_events_created_idx on public.game_events(created_at);
alter table public.game_events enable row level security;
revoke all on public.game_events from anon,authenticated;
grant select on public.game_events to anon,authenticated;
drop policy if exists game_events_read on public.game_events;
create policy game_events_read on public.game_events for select to anon,authenticated using (true);

create or replace function public.signal_game_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.game_events default values;
  if pg_catalog.random() < 0.01 then
    delete from public.game_events where created_at < pg_catalog.clock_timestamp() - interval '1 day';
  end if;
  return null;
end;
$$;
revoke all on function public.signal_game_change() from public,anon,authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['runs','teams','questions','rounds','answers','grades','score_entries','typing_runs','typing_team_progress'] loop
    execute format('drop trigger if exists signal_game_change on public.%I',table_name);
    execute format('create trigger signal_game_change after insert or update or delete on public.%I for each statement execute function public.signal_game_change()',table_name);
  end loop;
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_events') then
    alter publication supabase_realtime add table public.game_events;
  end if;
end;
$$;
