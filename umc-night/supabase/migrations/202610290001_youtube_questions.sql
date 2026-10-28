-- Store only a validated video ID, never arbitrary embed HTML or URLs.
alter table public.questions add column if not exists youtube_video_id text;
alter table public.questions add column if not exists youtube_start_seconds integer not null default 0;
alter table public.questions drop constraint if exists questions_youtube_check;
alter table public.questions add constraint questions_youtube_check check (
  (youtube_video_id is null and youtube_start_seconds = 0)
  or (youtube_video_id is not null and youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' and youtube_start_seconds between 0 and 86399 and kind <> 'typing')
);
