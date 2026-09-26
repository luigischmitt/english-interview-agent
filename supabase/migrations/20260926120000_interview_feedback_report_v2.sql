-- ENG-62: mark newly generated structured reports with the grounded v2 schema.
alter table public.interview_feedback
  alter column analysis_version set default 'v2';
