alter table public.questions
  add column if not exists scoring_mode text not null default 'all_correct';
alter table public.questions
  add column if not exists wait_for_all boolean not null default false;
alter table public.questions drop constraint if exists questions_scoring_mode_check;
alter table public.questions add constraint questions_scoring_mode_check
  check (scoring_mode in ('all_correct', 'first_correct'));
