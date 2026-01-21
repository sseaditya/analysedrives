-- POLICY: Allow Public to read .processed.json files for Public Activities
-- The existing policy only matches the exact 'file_path' (.gpx), so the sidecar JSON is blocked.

create policy "Public Access to Processed Files"
on storage.objects for select
using (
  bucket_id = 'gpx-files' 
  AND storage.objects.name LIKE '%.processed.json'
  AND EXISTS (
    SELECT 1 FROM public.activities 
    -- Match the JSON back to the GPX path in the DB
    WHERE public.activities.file_path = replace(storage.objects.name, '.processed.json', '.gpx')
    AND public.activities.public = true
  )
);
