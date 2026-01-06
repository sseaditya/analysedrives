-- POLICY: Allow Public to read GPX files for Public Activities
-- Since public can view public activities, we need to allow them to view the associated files in storage
-- NOTE: We must verify that the user requesting the file is allowed to see the activity record
-- NOTE: Supabase Storage RLS does not have direct access to "public.activities" unless we join or use helper functions.
-- Efficient strategy: Use a separate policy or make the bucket public. 
-- Assuming we want to keep the bucket private by default (best practice).

-- 1. Enable RLS on objects if not already
alter table storage.objects enable row level security;

-- 2. Policy for Owner (already likely exists, but good to ensure)
create policy "Owner Access"
on storage.objects for select
using (
  bucket_id = 'gpx-files' 
  AND auth.uid() = owner
);

-- 3. Policy for Public Access (Authenticated or Anon)
-- Only if the linked activity is public
create policy "Public Access to Public Files"
on storage.objects for select
using (
  bucket_id = 'gpx-files' 
  AND EXISTS (
    SELECT 1 FROM public.activities 
    WHERE public.activities.file_path = storage.objects.name 
    AND public.activities.public = true
  )
);
