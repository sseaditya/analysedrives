# Supabase SQL

[`supabase.sql`](./supabase.sql) is the canonical database script for the
project. Run it in the Supabase SQL Editor when setting up or reconciling an
environment.

The other files are the original, single-purpose scripts retained as migration
history. New Supabase schema or policy changes must also be reflected in
`supabase.sql`.

The original creation SQL for `public.activities`, `public.profiles`, and the
`gpx-files` storage bucket predates the repository and is therefore listed as a
prerequisite rather than recreated here
