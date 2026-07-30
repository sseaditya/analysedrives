-- Allow authenticated activity owners to create and replace GPX cache
-- artifacts in the gpx-files bucket.
--
-- This is required by Scan & Repair, activity privacy/speed-cap edits, and
-- new uploads. Access is limited to objects inside the caller's own top-level
-- folder or objects that map to an activity owned by the caller.

drop policy if exists "Owners can insert activity storage objects" on storage.objects;
create policy "Owners can insert activity storage objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'gpx-files'
  and (
    coalesce((storage.foldername(name))[1], '') = auth.uid()::text
    or exists (
      select 1
      from public.activities
      where public.activities.user_id = auth.uid()
        and (
          public.activities.file_path = storage.objects.name
          or regexp_replace(
            public.activities.file_path,
            '\.gpx$',
            '.processed.json',
            'i'
          ) = storage.objects.name
          or regexp_replace(
            public.activities.file_path,
            '\.gpx$',
            '.public.processed.json',
            'i'
          ) = storage.objects.name
        )
    )
  )
);

drop policy if exists "Owners can update activity storage objects" on storage.objects;
create policy "Owners can update activity storage objects"
on storage.objects for update
to authenticated
using (
  bucket_id = 'gpx-files'
  and (
    auth.uid() = owner
    or coalesce((storage.foldername(name))[1], '') = auth.uid()::text
    or exists (
      select 1
      from public.activities
      where public.activities.user_id = auth.uid()
        and (
          public.activities.file_path = storage.objects.name
          or regexp_replace(
            public.activities.file_path,
            '\.gpx$',
            '.processed.json',
            'i'
          ) = storage.objects.name
          or regexp_replace(
            public.activities.file_path,
            '\.gpx$',
            '.public.processed.json',
            'i'
          ) = storage.objects.name
        )
    )
  )
)
with check (
  bucket_id = 'gpx-files'
  and (
    auth.uid() = owner
    or coalesce((storage.foldername(name))[1], '') = auth.uid()::text
    or exists (
      select 1
      from public.activities
      where public.activities.user_id = auth.uid()
        and (
          public.activities.file_path = storage.objects.name
          or regexp_replace(
            public.activities.file_path,
            '\.gpx$',
            '.processed.json',
            'i'
          ) = storage.objects.name
          or regexp_replace(
            public.activities.file_path,
            '\.gpx$',
            '.public.processed.json',
            'i'
          ) = storage.objects.name
        )
    )
  )
);
