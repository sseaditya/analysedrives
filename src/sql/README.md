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

Backfill existing public activities from a trusted terminal with the production
Supabase URL and secret/service-role key in the environment:

```sh
npm run backfill:public-artifacts -- --dry-run
npm run backfill:public-artifacts
```

The command is idempotent: it skips artifacts that already use the current
artifact version and the activity's current speed cap and privacy radius.
Individual failures are reported without stopping the rest of the backfill.
Use `--force` only when every public artifact should be regenerated.

If the rollout needs to be undone, run `revert_public_processed_artifacts.sql`.
It removes only the new artifact policy.

## Activity artifact writes

Run `add_activity_artifact_write_policies.sql` if authenticated uploads,
Scan & Repair, or privacy-radius edits fail with
`new row violates row-level security policy`. It permits authenticated owners
to insert and update objects in their own `gpx-files` folder or sidecar
artifacts associated with an activity they own.
