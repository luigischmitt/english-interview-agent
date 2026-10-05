-- ENG-119: persist only the structured direction explicitly approved in interview setup.
-- The source job description is intentionally never stored with an interview.

create or replace function public.is_valid_interview_job_direction(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  competency jsonb;
  competency_count integer;
begin
  if value is null or jsonb_typeof(value) <> 'object' or octet_length(value::text) > 5_600 then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(value)) <> 5
    or not (value ?& array['targetRole', 'suggestedSeniority', 'mainInterviewEmphasis', 'priorityCompetencies', 'productTeamContext']) then
    return false;
  end if;
  if jsonb_typeof(value->'targetRole') <> 'string'
    or length(btrim(value->>'targetRole')) = 0 or length(value->>'targetRole') > 100 or position('?' in value->>'targetRole') > 0
    or jsonb_typeof(value->'suggestedSeniority') <> 'string'
    or value->>'suggestedSeniority' not in ('junior', 'mid-level', 'senior', 'staff')
    or jsonb_typeof(value->'mainInterviewEmphasis') <> 'string'
    or length(btrim(value->>'mainInterviewEmphasis')) = 0 or length(value->>'mainInterviewEmphasis') > 240 or position('?' in value->>'mainInterviewEmphasis') > 0
    or jsonb_typeof(value->'productTeamContext') <> 'string'
    or length(btrim(value->>'productTeamContext')) = 0 or length(value->>'productTeamContext') > 280 or position('?' in value->>'productTeamContext') > 0
    or jsonb_typeof(value->'priorityCompetencies') <> 'array' then
    return false;
  end if;
  competency_count := jsonb_array_length(value->'priorityCompetencies');
  if competency_count < 1 or competency_count > 5 then
    return false;
  end if;
  for competency in select item from jsonb_array_elements(value->'priorityCompetencies') as items(item) loop
    if jsonb_typeof(competency) <> 'string'
      or length(btrim(competency #>> '{}')) = 0 or length(competency #>> '{}') > 100 or position('?' in competency #>> '{}') > 0 then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.interviews
  add column job_direction jsonb,
  add constraint interviews_job_direction_valid_check
    check (job_direction is null or public.is_valid_interview_job_direction(job_direction)),
  add constraint interviews_job_direction_matches_session_check
    check (job_direction is null or (
      job_direction->>'targetRole' = target_role
      and job_direction->>'suggestedSeniority' = seniority
    ));
