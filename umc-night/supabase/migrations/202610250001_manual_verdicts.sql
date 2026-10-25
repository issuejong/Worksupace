alter table public.questions drop constraint if exists questions_answer_mode_check;
alter table public.questions add constraint questions_answer_mode_check check (
  (answer_mode = 'fixed' and correct_answer is not null and char_length(trim(correct_answer)) between 1 and 120)
  or (answer_mode = 'live' and correct_answer is null)
  or (answer_mode = 'manual' and kind = 'short' and (
    correct_answer is null or char_length(trim(correct_answer)) between 1 and 120
  ))
);
