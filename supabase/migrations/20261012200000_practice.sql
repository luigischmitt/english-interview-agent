-- Treinar (practice): plain-language themes built from the user's validated English errors and the
-- attempts at their exercises. Rows are written by the browser with the user's session; RLS keeps
-- every row private to its owner. A hidden theme (theme_key '_ignored') remembers errors that are not
-- worth practicing, so they are not sent for grouping again.

create table public.practice_themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_key text not null,
  title text not null,
  explanation text not null default '',
  why text not null default '',
  examples jsonb not null default '[]'::jsonb,
  error_refs jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  correct_streak smallint not null default 0,
  last_error_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint practice_themes_user_key_unique unique (user_id, theme_key),
  constraint practice_themes_key_check check (theme_key ~ '^(_ignored|[a-z0-9]+(-[a-z0-9]+){0,6})$'),
  constraint practice_themes_title_check check (length(btrim(title)) between 1 and 120),
  constraint practice_themes_explanation_check check (length(explanation) <= 400),
  constraint practice_themes_why_check check (length(why) <= 300),
  constraint practice_themes_examples_check check (jsonb_typeof(examples) = 'array' and jsonb_array_length(examples) <= 5),
  constraint practice_themes_error_refs_check check (jsonb_typeof(error_refs) = 'array' and jsonb_array_length(error_refs) <= 200),
  constraint practice_themes_status_check check (status in ('active', 'mastered', 'hidden')),
  constraint practice_themes_streak_check check (correct_streak between 0 and 1000)
);

create table public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_id uuid not null references public.practice_themes (id) on delete cascade,
  kind text not null,
  instruction text not null,
  mode text not null,
  answer text not null,
  verdict text not null,
  feedback text not null default '',
  corrected text not null default '',
  created_at timestamptz not null default timezone('utc', now()),

  constraint practice_attempts_kind_check check (kind in ('fix', 'build')),
  constraint practice_attempts_mode_check check (mode in ('text', 'voice')),
  constraint practice_attempts_verdict_check check (verdict in ('correct', 'almost', 'incorrect')),
  constraint practice_attempts_instruction_check check (length(instruction) between 1 and 400),
  constraint practice_attempts_answer_check check (length(answer) between 1 and 1000),
  constraint practice_attempts_feedback_check check (length(feedback) <= 400),
  constraint practice_attempts_corrected_check check (length(corrected) <= 400)
);

create function public.set_practice_themes_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger set_practice_themes_updated_at
before update on public.practice_themes
for each row
execute function public.set_practice_themes_updated_at();

create index practice_themes_user_id_idx
  on public.practice_themes (user_id, updated_at desc);

create index practice_attempts_user_theme_created_idx
  on public.practice_attempts (user_id, theme_id, created_at desc);

create index practice_attempts_theme_id_idx
  on public.practice_attempts (theme_id);

alter table public.practice_themes enable row level security;
alter table public.practice_attempts enable row level security;

create policy "Users can view their own practice themes"
  on public.practice_themes for select
  using ((select auth.uid()) = user_id);

create policy "Users can create their own practice themes"
  on public.practice_themes for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own practice themes"
  on public.practice_themes for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own practice themes"
  on public.practice_themes for delete
  using ((select auth.uid()) = user_id);

create policy "Users can view their own practice attempts"
  on public.practice_attempts for select
  using ((select auth.uid()) = user_id);

create policy "Users can create attempts for their own practice themes"
  on public.practice_attempts for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.practice_themes
      where practice_themes.id = practice_attempts.theme_id
        and practice_themes.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own practice attempts"
  on public.practice_attempts for delete
  using ((select auth.uid()) = user_id);
