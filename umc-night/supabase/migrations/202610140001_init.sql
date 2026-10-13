-- UMC Night is a single-event application. All browser traffic goes through
-- the Next.js server; the database credentials must never reach the browser.
create extension if not exists pgcrypto;

create table if not exists public.host_users (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  number smallint not null unique check (number between 1 and 3),
  name text not null check (char_length(trim(name)) between 1 and 32),
  code_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.team_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_sessions_team_idx on public.team_sessions(team_id);
create unique index if not exists team_sessions_one_current_idx on public.team_sessions(team_id) where revoked_at is null;

create table if not exists public.join_attempts (
  key_hash text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  kind text not null check (kind in ('short','choice','ox')),
  prompt text not null check (char_length(trim(prompt)) between 1 and 500),
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null check (char_length(trim(correct_answer)) between 1 and 120),
  points integer not null default 100 check (points between 1 and 1000),
  duration_seconds integer not null default 45 check (duration_seconds between 5 and 300),
  position integer not null default 0,
  practice boolean not null default false,
  active boolean not null default true,
  image_path text,
  reveal_image_path text,
  created_at timestamptz not null default now()
);
create index if not exists questions_round_position_idx on public.questions(round_id,position,created_at);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp')),
  created_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('rehearsal','event')),
  phase text not null default 'lobby' check (phase in ('lobby','live','paused','closed','revealed','graded','finished')),
  current_run_question_id uuid,
  version integer not null default 0,
  deadline_at timestamptz,
  remaining_seconds integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists runs_one_active_idx on public.runs ((true)) where phase <> 'finished';

create table if not exists public.run_questions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  snapshot jsonb not null,
  voided boolean not null default false,
  graded_at timestamptz,
  started_at timestamptz not null default now(),
  unique(run_id,question_id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='runs_current_question_fk') then
    alter table public.runs add constraint runs_current_question_fk foreign key (current_run_question_id) references public.run_questions(id) on delete set null;
  end if;
end $$;

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  run_question_id uuid not null references public.run_questions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  value text not null check (char_length(value) between 1 and 300),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(run_question_id,team_id)
);

create table if not exists public.answer_requests (
  id uuid primary key,
  answer_id uuid not null references public.answers(id) on delete cascade,
  accepted_version integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.grades (
  run_question_id uuid not null references public.run_questions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  correct boolean not null,
  points integer not null check (points >= 0),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(run_question_id,team_id)
);

create table if not exists public.score_entries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  run_question_id uuid not null references public.run_questions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  delta integer not null,
  reason text not null check (char_length(trim(reason)) between 1 and 200),
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists score_entries_run_idx on public.score_entries(run_id,team_id);

-- Supabase REST roles cannot read these tables. The server uses the private
-- transaction-pooler connection string and performs its own role checks.
do $$
declare name text;
begin
  foreach name in array array['host_users','teams','team_sessions','join_attempts','rounds','questions','media','runs','run_questions','answers','answer_requests','grades','score_entries'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on public.%I from anon, authenticated', name);
  end loop;
end $$;

-- The bucket is private. No browser storage policies are granted.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('quiz-media','quiz-media',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
