-- FORWARD / TRANSITIONAL MIGRATION
--
-- Adds public read access to sanitized *.public.processed.json artifacts.
-- Existing raw GPX and full processed-file public policies are intentionally
-- left in place as an availability fallback during the rollout.
-- This migration is additive: it does not replace or revoke any existing
-- policy and does not modify or delete stored data.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public Access to Public Processed Files'
  ) then
    create policy "Public Access to Public Processed Files"
    on storage.objects for select
    using (
      bucket_id = 'gpx-files'
      and storage.objects.name like '%.public.processed.json'
      and exists (
        select 1
        from public.activities
        where public.activities.public = true
          and replace(
            public.activities.file_path,
            '.gpx',
            '.public.processed.json'
          ) = storage.objects.name
      )
    );
  end if;
end
$$;
