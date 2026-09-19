-- ENG-9: minimal persistence model for interview sessions and ordered turns.
-- Authentication itself is intentionally handled by a later issue. The
-- foreign key and RLS policies are ready for Supabase Auth users.

create extension if not exists pgcrypto;

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_role text not null,
  seniority text,
  focus text,
  duration_minutes smallint,
  question_count smallint,
  status text not null default 'draft',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint interviews_duration_minutes_check
    check (duration_minutes is null or duration_minutes between 1 and 180),
  constraint interviews_question_count_check
    check (question_count is null or question_count between 1 and 50),
  constraint interviews_target_role_not_blank_check
    check (length(btrim(target_role)) > 0),
  constraint interviews_status_check
    check (status in ('draft', 'in_progress', 'completed', 'abandoned'))
);

create table public.interview_turns (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  sequence_number integer not null,
  speaker text not null,
  content text,
  created_at timestamptz not null default timezone('utc', now()),

  constraint interview_turns_sequence_number_check
    check (sequence_number > 0),
  constraint interview_turns_speaker_check
    check (speaker in ('interviewer', 'candidate')),
  constraint interview_turns_interview_sequence_unique
    unique (interview_id, sequence_number)
);

create function public.set_interviews_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger interviews_set_updated_at
before update on public.interviews
for each row
execute function public.set_interviews_updated_at();

create index interviews_user_id_created_at_idx
  on public.interviews (user_id, created_at desc);

create index interview_turns_interview_id_idx
  on public.interview_turns (interview_id);

alter table public.interviews enable row level security;
alter table public.interview_turns enable row level security;

create policy "Users can view their own interviews"
  on public.interviews
  for select
  using ((select auth.uid()) = user_id);

create policy "Users can create their own interviews"
  on public.interviews
  for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own interviews"
  on public.interviews
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own interviews"
  on public.interviews
  for delete
  using ((select auth.uid()) = user_id);

create policy "Users can view turns from their own interviews"
  on public.interview_turns
  for select
  using (
    exists (
      select 1
      from public.interviews
      where interviews.id = interview_turns.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );

create policy "Users can create turns for their own interviews"
  on public.interview_turns
  for insert
  with check (
    exists (
      select 1
      from public.interviews
      where interviews.id = interview_turns.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );

create policy "Users can update turns from their own interviews"
  on public.interview_turns
  for update
  using (
    exists (
      select 1
      from public.interviews
      where interviews.id = interview_turns.interview_id
        and interviews.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.interviews
      where interviews.id = interview_turns.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );

create policy "Users can delete turns from their own interviews"
  on public.interview_turns
  for delete
  using (
    exists (
      select 1
      from public.interviews
      where interviews.id = interview_turns.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );
