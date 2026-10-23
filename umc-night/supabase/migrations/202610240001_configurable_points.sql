-- Restore per-question awards without changing any existing results.
alter table public.questions drop constraint if exists questions_single_count_check;
alter table public.questions drop constraint if exists questions_points_check;
alter table public.questions drop constraint if exists questions_configurable_points_check;
alter table public.questions add constraint questions_configurable_points_check check (points between 1 and 1000);
alter table public.questions alter column points set default 1;
alter table public.grades drop constraint if exists grades_single_count_check;
alter table public.grades drop constraint if exists grades_configurable_points_check;
alter table public.grades add constraint grades_configurable_points_check check (points between 0 and 1000);
alter table public.score_entries drop constraint if exists score_entries_single_count_check;
alter table public.score_entries drop constraint if exists score_entries_configurable_points_check;
alter table public.score_entries add constraint score_entries_configurable_points_check check (delta between -1000 and 1000);
