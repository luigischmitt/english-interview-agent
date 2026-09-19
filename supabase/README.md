# Supabase database

The versioned migrations in this directory define the minimum persistence
model for interview sessions and their ordered turns.

## Migration scope

- `interviews` stores the session configuration and lifecycle timestamps.
- `interview_turns` stores the ordered interviewer/candidate turns.
- Both tables use UUID identifiers and ownership-based Row Level Security.
- Turns are deleted automatically when their interview is deleted.

Authentication, login screens, and session handling are intentionally outside
this migration and belong to the following authentication issue.

## Applying migrations

Review the SQL before applying it to any environment. Applying it to the
hosted Supabase project requires an authenticated Supabase CLI session and is
not part of this change. For local development, use the project's normal
Supabase CLI workflow (`supabase db reset` or `supabase db push`) after linking
the intended project.

No project URL, publishable key, service-role key, password, or private token
is stored in this directory.
