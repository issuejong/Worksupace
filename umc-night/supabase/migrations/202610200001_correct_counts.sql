-- Older rehearsals used configurable point values. Preserve their verdicts and
-- correction history while expressing every award or reversal as one answer.
update public.questions set points=1 where points<>1;
alter table public.questions alter column points set default 1;
update public.run_questions set snapshot=snapshot-'points' where snapshot ? 'points';
update public.grades set points=case when points>0 then 1 else 0 end where points>1;
update public.score_entries set delta=sign(delta) where abs(delta)>1;
alter table public.questions drop constraint if exists questions_single_count_check;
alter table public.questions add constraint questions_single_count_check check (points=1);
alter table public.grades drop constraint if exists grades_single_count_check;
alter table public.grades add constraint grades_single_count_check check (points between 0 and 1);
alter table public.score_entries drop constraint if exists score_entries_single_count_check;
alter table public.score_entries add constraint score_entries_single_count_check check (delta between -1 and 1);
