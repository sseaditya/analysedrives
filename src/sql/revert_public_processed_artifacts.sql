-- ROLLBACK for add_public_processed_artifacts.sql
--
-- Removes only the new public-artifact policy. The pre-existing raw GPX and
-- full processed-file policies remain unchanged.

drop policy if exists "Public Access to Public Processed Files" on storage.objects;
