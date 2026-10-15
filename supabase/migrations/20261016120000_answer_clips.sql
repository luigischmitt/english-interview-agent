insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('answer-clips', 'answer-clips', false, 1048576, array['audio/webm'])
on conflict (id) do nothing;

create policy "Users can read their answer clips"
on storage.objects for select to authenticated
using (bucket_id = 'answer-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can upload their answer clips"
on storage.objects for insert to authenticated
with check (bucket_id = 'answer-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can update their answer clips"
on storage.objects for update to authenticated
using (bucket_id = 'answer-clips' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'answer-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can delete their answer clips"
on storage.objects for delete to authenticated
using (bucket_id = 'answer-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
