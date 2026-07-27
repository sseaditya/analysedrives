-- Migrated storage objects do not always retain Supabase's storage owner
-- metadata. Authorize an activity owner from the canonical activities row as
-- well, for both the raw GPX and its processed cache.

drop policy if exists "Owner Access" on storage.objects;
create policy "Owner Access"
on storage.objects for select
using (
  bucket_id = 'gpx-files'
  and (
    auth.uid() = owner
    or exists (
      select 1
      from public.activities
      where public.activities.user_id = auth.uid()
        and (
          public.activities.file_path = storage.objects.name
          or replace(public.activities.file_path, '.gpx', '.processed.json') = storage.objects.name
          or replace(public.activities.file_path, '.gpx', '.public.processed.json') = storage.objects.name
        )
    )
  )
);
