-- Existing team sessions and scores remain intact. New teams can be created
-- from the public QR join page without a fixed count or a team code.
alter table public.teams drop constraint if exists teams_number_check;
alter table public.teams alter column number type integer;
alter table public.teams alter column code_hash drop not null;
