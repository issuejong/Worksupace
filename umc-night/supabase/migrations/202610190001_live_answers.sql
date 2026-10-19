alter table public.questions
  add column if not exists answer_mode text not null default 'fixed';
alter table public.questions alter column correct_answer drop not null;
alter table public.questions drop constraint if exists questions_correct_answer_check;
alter table public.questions drop constraint if exists questions_answer_mode_check;
alter table public.questions add constraint questions_answer_mode_check check (
  (answer_mode = 'fixed' and correct_answer is not null and char_length(trim(correct_answer)) between 1 and 120)
  or (answer_mode = 'live' and correct_answer is null)
);
alter table public.run_questions
  add column if not exists selected_answer text;
