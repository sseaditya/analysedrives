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

## Public processed artifact rollout

Run `add_public_processed_artifacts.sql` to allow public activities to serve
their sanitized `*.public.processed.json` artifact. This transitional migration
does not remove the existing raw GPX or full processed-file policies, so the
legacy availability fallback continues to work.

If the rollout needs to be undone, run `revert_public_processed_artifacts.sql`.
It removes only the new artifact policy.
