-- ENG-54: one private final report record per interview.
create table public.interview_feedback (
  interview_id uuid primary key references public.interviews (id) on delete cascade,
  status text not null default 'pending',
  azure_summary jsonb,
  analysis jsonb,
  model text,
  analysis_version text not null default 'v1',
  generated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint interview_feedback_status_check
    check (status in ('pending', 'ready', 'unavailable')),
  constraint interview_feedback_ready_has_analysis_check
    check (status <> 'ready' or analysis is not null)
);

create function public.set_interview_feedback_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger interview_feedback_set_updated_at
before update on public.interview_feedback
for each row
execute function public.set_interview_feedback_updated_at();

alter table public.interview_feedback enable row level security;

create policy "Users can view feedback for their own interviews"
  on public.interview_feedback
  for select
  using (
    exists (
      select 1 from public.interviews
      where interviews.id = interview_feedback.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );

create policy "Users can create feedback for their own interviews"
  on public.interview_feedback
  for insert
  with check (
    exists (
      select 1 from public.interviews
      where interviews.id = interview_feedback.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );

create policy "Users can update feedback for their own interviews"
  on public.interview_feedback
  for update
  using (
    exists (
      select 1 from public.interviews
      where interviews.id = interview_feedback.interview_id
        and interviews.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.interviews
      where interviews.id = interview_feedback.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );

create policy "Users can delete feedback for their own interviews"
  on public.interview_feedback
  for delete
  using (
    exists (
      select 1 from public.interviews
      where interviews.id = interview_feedback.interview_id
        and interviews.user_id = (select auth.uid())
    )
  );
