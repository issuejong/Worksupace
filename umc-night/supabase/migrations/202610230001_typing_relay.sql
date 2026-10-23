alter table public.questions drop constraint if exists questions_kind_check;
alter table public.questions add constraint questions_kind_check check (kind in ('short','choice','ox','typing'));
alter table public.questions add column if not exists typing_phrases jsonb not null default '[]'::jsonb;
alter table public.questions add column if not exists typing_award_winner boolean not null default false;

create table if not exists public.typing_runs (
  run_question_id uuid primary key references public.run_questions(id) on delete cascade,
  starts_at timestamptz,
  paused_at timestamptz,
  paused_ms bigint not null default 0 check (paused_ms >= 0),
  close_reason text,
  closed_by uuid
);
create table if not exists public.typing_team_progress (
  run_question_id uuid not null references public.typing_runs(run_question_id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  ready boolean not null default false,
  turn integer not null default 0 check (turn >= 0),
  mistakes integer not null default 0 check (mistakes >= 0),
  version integer not null default 0,
  completed_at timestamptz,
  elapsed_ms bigint,
  result_ms bigint,
  primary key (run_question_id,team_id)
);
create table if not exists public.typing_attempts (
  id uuid primary key,
  run_question_id uuid not null,
  team_id uuid not null,
  turn integer not null,
  value text not null,
  correct boolean not null,
  received_at timestamptz not null default clock_timestamp(),
  result jsonb not null,
  foreign key (run_question_id,team_id) references public.typing_team_progress(run_question_id,team_id) on delete cascade
);
create index if not exists typing_attempts_progress_idx on public.typing_attempts(run_question_id,team_id);
alter table public.typing_runs enable row level security;
alter table public.typing_team_progress enable row level security;
alter table public.typing_attempts enable row level security;
revoke all on public.typing_runs,public.typing_team_progress,public.typing_attempts from anon,authenticated;
