-- Remove the retired generic lesson system. Its stored practice history is intentionally discarded
-- as part of the product direction change; interview feedback and interview turns are unaffected.
drop table if exists public.practice_attempts cascade;
drop table if exists public.practice_themes cascade;
drop function if exists public.set_practice_themes_updated_at() cascade;

create table if not exists public.voice_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  client_attempt_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  interview_id uuid not null references public.interviews (id) on delete cascade,
  candidate_sequence_number integer not null,
  source_kind text not null,
  phrase_index integer,
  normalized_target text not null,
  target_text text not null,
  assessment jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),

  constraint voice_practice_attempts_client_unique unique (user_id, client_attempt_id),
  constraint voice_practice_attempts_origin_check check (
    candidate_sequence_number > 0
    and source_kind in ('voice_phrase', 'english_correction')
    and ((source_kind = 'voice_phrase' and phrase_index is not null and phrase_index >= 0)
      or (source_kind = 'english_correction' and phrase_index is null))
  ),
  constraint voice_practice_attempts_target_check check (
    length(btrim(normalized_target)) between 1 and 600
    and length(btrim(target_text)) between 1 and 600
  ),
  constraint voice_practice_attempts_assessment_check check (
    jsonb_typeof(assessment) = 'object'
    and octet_length(assessment::text) <= 8192
  )
);

create index if not exists voice_practice_attempts_user_origin_created_idx
  on public.voice_practice_attempts (user_id, interview_id, candidate_sequence_number, source_kind, phrase_index, created_at desc);

alter table public.voice_practice_attempts enable row level security;

drop policy if exists "Users can view their own voice practice attempts" on public.voice_practice_attempts;
create policy "Users can view their own voice practice attempts"
  on public.voice_practice_attempts for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can create their own voice practice attempts" on public.voice_practice_attempts;
create policy "Users can create their own voice practice attempts"
  on public.voice_practice_attempts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.interviews
      where interviews.id = voice_practice_attempts.interview_id
        and interviews.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.interview_turns
      where interview_turns.interview_id = voice_practice_attempts.interview_id
        and interview_turns.sequence_number = voice_practice_attempts.candidate_sequence_number
        and interview_turns.speaker = 'candidate'
    )
  );

drop policy if exists "Users can delete their own voice practice attempts" on public.voice_practice_attempts;
create policy "Users can delete their own voice practice attempts"
  on public.voice_practice_attempts for delete to authenticated
  using (user_id = (select auth.uid()));
