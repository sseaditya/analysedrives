# Security and Performance Audit Issues

Audit date: 2026-07-21  
Scope: Vite/React client, Vercel serverless APIs, Supabase SQL/storage policies, Strava OAuth, GPX processing, maps, charts, and video generation.

This document records the findings from a read-only repository audit. Severity reflects the impact visible in the checked-in code; deployment configuration and the live Supabase database were not penetration-tested.

## Priority order

1. Stop exposing raw public GPX/processed data and replace it with sanitized public artifacts.
2. Lock down segment indexing and remove private-activity inference/global backfill access.
3. Move Strava tokens server-side and add a state-bound OAuth flow.
4. Make data deletion durable, complete, and retryable.
5. Check in and test the complete Supabase schema and RLS policies.
6. Address unbounded queries, bundle size, uploads, and video generation.
7. Add security headers, rate limits, privacy disclosures, and passing quality gates.

## Critical

### SEC-001: Public activities expose complete routes and uncapped telemetry

**Status:** Open  
**Severity:** Critical

Privacy zones and speed caps are currently presentation-layer transformations rather than access controls.

Evidence:

- `src/sql/supabase.sql:37-61` grants public read access to the raw GPX and complete `.processed.json` object for public activities.
- `src/pages/Activity.tsx:173-220` downloads the complete processed track or GPX before applying any privacy behavior.
- `src/components/GPSStats.tsx:233-242` retains full points and statistics for a non-owner and only clips the points passed to the map.
- `src/pages/Feed.tsx:297-303` renders raw `previewCoordinates` and `previewSpeeds`, exposing start/end locations in the normal public UI.
- `src/pages/Dashboard.tsx:391-403` and `src/components/StravaImport.tsx:141-151` store raw previews and speed statistics together in `activities.stats`.
- `src/sql/supabase.sql:251-277` returns raw `stats` and `file_path` from the leaderboard RPC even when leaderboard metrics are privacy-adjusted.
- `src/pages/Privacy.tsx:74-81` says only analyzed public data is shared, which does not match the implemented access model.

Impact:

- Public viewers can recover precise start/end locations, complete routes, timestamps, elevations, and raw speeds.
- A configured speed cap can be bypassed by reading the raw row, GPX, processed file, or leaderboard response.
- The advertised start/end privacy zone can reveal home, work, and frequently visited locations.

Remediation:

- Keep raw GPX and complete processed JSON private for every activity, including public activities.
- Generate a separate server-side public artifact when sharing is enabled.
- Remove the configured start/end distance before persisting that artifact.
- Remove or normalize timestamps and cap/aggregate every speed-bearing field.
- Expose public data through a restricted view/RPC or dedicated `public_activity_artifacts` table.
- Never return raw `file_path` or raw `stats` to non-owners.
- Revoke the existing public policies on raw files, regenerate sanitized artifacts for existing public activities, and purge old public caches.
- Add tests that fetch public records/files as `anon`, `authenticated owner`, and `authenticated non-owner`.

Changing React rendering alone is insufficient because callers can access the underlying data directly.

## High

### SEC-002: Segment indexing permits service-role resource abuse and private-route inference

**Status:** Open  
**Severity:** High

Evidence:

- `api/index-segments.ts:272-281` accepts any existing `segmentId` from any authenticated user without checking `segment.created_by`.
- The client controls `force`, which bypasses the algorithm-version shortcut.
- `api/index-segments.ts:186-227` fetches all activities using a service-role client and downloads/processes candidate tracks.
- The response includes global `checked` and `matched` counts derived from private as well as public activities.
- `src/sql/supabase.sql:68-81` validates segment geometry only as an array containing at least two items. It has no maximum length, coordinate schema, geographic bounds, monotonic distance check, or relationship to the source activity.

Impact:

- Repeated forced backfills can consume serverless execution, database queries, storage bandwidth, and CPU.
- Crafted segments can probe whether private activities intersect selected roads through aggregate match counts.
- Oversized or malformed geometry can amplify computational cost.
- Private route-derived alignments are unnecessarily replicated into `segment_efforts`.

Remediation:

- Require segment ownership or a privileged background-worker role.
- Remove client-controlled `force` and expose controlled retry semantics instead.
- Derive segment geometry server-side from an owned, eligible source activity.
- Enforce strict coordinate, bounds, point-count, distance, and payload-size limits.
- Move global backfills to a rate-limited, idempotent job queue with pagination, deadlines, quotas, and cancellation.
- Do not return counts or errors derived from private activities.
- Prefer indexing private activity data only for its owner.
- Add endpoint-level rate limits and audit logs.

### SEC-003: Strava OAuth tokens are exposed to browser JavaScript

**Status:** Open  
**Severity:** High

Evidence:

- `src/lib/strava.ts:20-27` starts authorization without a `state` nonce.
- `api/exchange-token.ts:3-50` is unauthenticated, uses wildcard CORS, and returns the entire Strava token response to the browser.
- That response includes a refresh token, short-lived access token, expiry data, and athlete information.
- `src/pages/StravaCallback.tsx:29-40` persists the access token in `localStorage`.
- The flow does not validate accepted scopes or athlete identity and does not implement refresh-token rotation or revocation.

Impact:

- OAuth login CSRF/confused-deputy behavior can associate the wrong Strava athlete with an application session.
- Any future XSS gains direct access to the long-lived browser token state.
- Tokens may be exposed through browser tooling or third-party JavaScript.
- Imports fail when the short-lived access token expires.

Remediation:

- Require a signed-in Supabase user before initiating and completing Strava OAuth.
- Generate a cryptographically random `state`, bind it to the application user in an HttpOnly/SameSite cookie or server record, and consume it once.
- Store access and refresh tokens encrypted server-side.
- Proxy Strava requests through authenticated application endpoints and never return refresh tokens to browser JavaScript.
- Validate the granted scope and athlete identity.
- Refresh tokens server-side and revoke them on disconnect and account deletion.
- Restrict the exchange endpoint to the production origin and add request validation/rate limiting.

Reference: <https://developers.strava.com/docs/authentication/>

### PRIV-001: Activity and account deletion can leave personal data behind

**Status:** Open  
**Severity:** High

Evidence:

- `src/pages/Dashboard.tsx:126-146` removes only the raw `filePath`, not its `.processed.json` sidecar.
- `src/components/ActivityEditor.tsx:115-135` has the same incomplete deletion behavior.
- Both paths log storage errors but continue deleting the database row, creating orphaned objects.
- `api/deactivate-account.ts:145-203` treats storage deletion failures as warnings and can delete database rows and the auth identity anyway.
- Avatar updates use timestamped object names without removing old versions.
- `src/pages/Privacy.tsx:85-89` promises that individual deletion immediately and permanently removes associated files.

Impact:

- GPS coordinates and derived telemetry can remain in storage after apparent deletion.
- Removing the database/user identity after a storage failure makes retries and reconciliation harder.
- Orphaned objects create continuing storage cost and data-retention/compliance exposure.

Remediation:

- Centralize deletion in an authenticated server endpoint.
- Create a durable deletion manifest/job covering raw GPX, processed JSON, avatars, efforts, and future derived artifacts.
- Verify deletion and retry failures before removing the identity/metadata needed to locate objects.
- Return `202 Accepted` while erasure is pending rather than reporting success with warnings.
- Add storage lifecycle cleanup for unreferenced objects.
- Delete superseded avatar objects after a successful profile update.

### SEC-004: Core database/RLS policies are missing from source control

**Status:** Verification required  
**Severity:** High if live policies are incomplete

Evidence:

- `src/sql/README.md:11-13` states that creation SQL for `activities`, `profiles`, and the `gpx-files` bucket predates the repository and is not recreated.
- Those missing policies control the application's most sensitive data and cannot be reviewed or reproduced from this repository.
- `src/sql/supabase.sql:18-35` trusts an `activities.file_path` associated with the current user as an ownership signal.
- The policy uses Supabase's deprecated `owner` field rather than `owner_id`.

Conditional attack path:

If the live activity insert/update policy does not make `user_id` and `file_path` immutable and constrain the path to the user's UUID prefix, a user may be able to reference another user's storage object. The checked-in owner policy could then grant read access, and the service-role account-deletion flow could delete the referenced object.

Remediation:

- Check in the complete schema, grants, functions, triggers, bucket configuration, and RLS policies as migrations.
- Require `activities.user_id = auth.uid()` on insert/update.
- Make `user_id` and `file_path` immutable.
- Require `file_path` and storage object paths to start with the authenticated user's UUID folder.
- Use `owner_id` and explicit `to authenticated` roles where appropriate.
- Add a unique/indexed constraint on `activities.file_path`.
- Test all operations as anon, owner, non-owner, and service role.
- Verify upload MIME/size restrictions at the bucket level.

References:

- <https://supabase.com/docs/guides/storage/security/access-control>
- <https://supabase.com/docs/guides/storage/security/ownership>

## Medium

### PRIV-002: Private route rendering discloses location-derived tile requests to third parties

**Status:** Open  
**Severity:** Medium

Evidence:

- `src/components/ActivityMiniMap.tsx:117-129`, `src/components/TrackMap.tsx`, `src/components/ComparisonMap.tsx`, `src/pages/Analytics.tsx`, `src/utils/shareImage.ts`, and `src/components/VideoGenerator.tsx` request map tiles from CARTO and OpenTopoMap.
- Tile URLs encode the geographic tiles being viewed, while the provider also receives request metadata such as IP address.
- `src/index.css:1-3` loads fonts from Google.
- Profile fallbacks contact `ui-avatars.com`, and the dashboard embeds YouTube.
- `src/pages/Privacy.tsx:92-100` lists only Google Identity Services and Supabase as third-party providers and omits Strava, CARTO, OpenTopoMap, Google Fonts, UI Avatars, and YouTube.

Remediation:

- Update disclosures and consent behavior to match actual data flows.
- Self-host fonts and generate fallback avatars locally.
- Consider proxying/caching map tiles or offering a route-only mode for private activities.
- Review provider terms, retention, and required attribution/DPA obligations.
- Avoid loading third-party resources until the relevant feature is used.

### SEC-005: APIs lack defensive headers, narrow CORS, rate limits, and consistent request schemas

**Status:** Open  
**Severity:** Medium

Evidence:

- `vercel.json` defines only rewrites and no application security headers.
- `api/exchange-token.ts`, `api/index-segments.ts`, and `api/deactivate-account.ts` use wildcard CORS.
- `exchange-token` and `deactivate-account` combine `Access-Control-Allow-Credentials: true` with `Access-Control-Allow-Origin: *`, an invalid browser configuration.
- Expensive endpoints have no visible rate limiting or workload quotas.
- API inputs are mostly checked only for presence/type, without length, UUID, or schema constraints.
- `api/index-segments.ts` may return internal Supabase/storage error details to authenticated callers.

Remediation:

- Remove CORS entirely for same-origin endpoints or use an exact origin allowlist.
- Add per-user/IP rate limits and concurrency limits.
- Validate every request with strict schemas and body-size limits.
- Return stable public error codes and keep detailed errors in server logs.
- Add an application-specific CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and clickjacking protection.
- Review caching headers for immutable assets and sensitive API responses.

Reference: <https://vercel.com/docs/headers>

### PERF-001: Feed, dashboard, analytics, and segment workflows fetch unbounded datasets

**Status:** Open  
**Severity:** Medium, becoming High as data grows

Evidence:

- `src/pages/Feed.tsx:119-174` fetches every public activity using `select('*')`, then sorts, searches, and paginates in the browser.
- Dashboard fetches every owned activity using `select('*')` and paginates locally.
- `src/pages/Analytics.tsx:67-110` fetches all owned rows and then all accessible activity rows on every load, even when the global heatmap is disabled.
- Analytics listens to both `focus` and `visibilitychange`, which can trigger duplicate refreshes.
- Activity `stats` contains arrays such as preview coordinates, speeds, distributions, and records, making `select('*')` increasingly expensive.
- Segment live matching fetches accessible activities and downloads each candidate track.
- Server indexing scans all segments for an activity or all activities for a segment.

Remediation:

- Use keyset/server pagination and explicit summary columns.
- Separate list summaries from full activity analytics payloads.
- Query global heatmap data only when enabled.
- Serve a pre-aggregated, privacy-safe heatmap representation.
- Use the installed React Query client to cache, deduplicate, and cancel requests.
- Add indexes matching `public, created_at`, `user_id, created_at`, and `file_path` access patterns.
- Replace global synchronous matching with bounded background jobs.

### PERF-002: Initial production bundle is oversized because all routes are eager

**Status:** Open  
**Severity:** Medium

Observed production build:

- JavaScript: 1,421.46 KB minified / 405.94 KB gzip.
- CSS: 97.61 KB / 20.59 KB gzip.
- Vite emitted its large-chunk warning.

Evidence:

- `src/App.tsx:7-25` eagerly imports every route.
- The activity route eagerly includes GPS charts, Leaflet maps, MP4 muxing, and video generation.
- Analytics and comparison routes also bring Leaflet/Recharts code into the initial chunk.

Remediation:

- Use `React.lazy()` and `Suspense` at route boundaries.
- Load `VideoGenerator` only when its dialog opens.
- Split mapping, charting, analytics, comparison, and MP4 dependencies into separate chunks.
- Measure route-level transfer, parse, and execution time after splitting.

### PERF-003: GPX upload and processing workloads are unbounded

**Status:** Open  
**Severity:** Medium

Evidence:

- `src/components/FileUploader.tsx:14-42` checks only the `.gpx` filename suffix.
- There is no per-file size, total batch size, file count, point count, coordinate range, or time-span limit.
- All files are read as strings and retained before sequential parsing/upload.
- Parsing and processed-track generation run on the browser main thread.
- Server-side parsing can also process owner-controlled files without explicit object or point limits.

Indicative local benchmark:

- 1,000 points: approximately 8 ms, 0.26 MB processed JSON.
- 10,000 points: approximately 55 ms, 2.56 MB processed JSON.
- 50,000 points: approximately 220 ms, 12.81 MB processed JSON.

This benchmark used simple synthetic data and does not include DOM parsing, React work, network buffers, or multiple simultaneous files.

Remediation:

- Configure bucket-level maximum size and allowed MIME types.
- Enforce client and server file/count/point/time-span limits.
- Validate coordinates, timestamps, and monotonically sensible samples.
- Move parsing and analysis into a Web Worker.
- Avoid retaining all uploaded file strings at once.
- Consider streaming/incremental parsing for large tracks.

### PERF-004: Video generation and map tile caching can exhaust browser memory

**Status:** Open  
**Severity:** Medium

Evidence:

- `src/components/VideoGenerator.tsx:533-624` calculates an unbounded frame count from activity duration and muxes the complete MP4 into an in-memory `ArrayBufferTarget`.
- Available output includes 4K at high bitrate and a minimum speed multiplier of 15x.
- `src/components/VideoGenerator.tsx:167-215` uses a module-level map tile cache with no size limit or eviction.

Impact:

- Long tracks can create tens of thousands of frames and multi-gigabyte theoretical output buffers.
- Repeated routes/styles/zoom levels can retain many decoded images for the lifetime of the application tab.

Remediation:

- Cap output duration, total frames, resolution, bitrate, and estimated output bytes.
- Warn or block before encoding exceeds a safe device budget.
- Prefer streaming mux output where supported.
- Replace the tile map with a bounded LRU cache and release image references on close.
- Handle cancellation and encode failures with full encoder/muxer cleanup.

### REL-001: TypeScript and lint quality gates fail

**Status:** Open  
**Severity:** Medium

Validation results:

- Tests: 38/38 passed across 7 files.
- Production build: passed with the oversized-chunk warning.
- TypeScript: failed at `src/components/SpeedElevationChart.tsx:523` because `activeLabel` may be a number but is passed to `parseFloat` as a string.
- ESLint: failed with 14 errors and 25 warnings.
- `src/components/DistanceTimeChart.tsx:110-128` calls hooks after a conditional return, violating hook ordering and risking a runtime failure when data changes between empty and non-empty.
- Several effects/callbacks have missing or unstable dependencies, which may cause stale state or redundant work.
- Browserslist data is reported as 13 months old.

Remediation:

- Fix the conditional hook ordering first.
- Resolve the TypeScript failure and make `tsc` a required CI check.
- Separate generated/vendor-style lint noise from application code, but keep React hook rules blocking.
- Resolve stale dependency warnings based on intended behavior rather than suppressing them broadly.
- Add `test`, `lint`, `typecheck`, and `build` as required CI jobs.

## Dependency and scan coverage

- `npm ls --depth=0` completed successfully; the installed dependency tree resolves.
- A current vulnerability-database scan was not completed. The execution environment blocked `npm audit` because it would send the private workspace's dependency manifest to the npm registry.
- Run `npm audit` or an approved lockfile scanner in trusted local/CI infrastructure. Do not interpret this audit as confirming zero vulnerable dependencies.
- The current-source scan found no hard-coded service-role/client secrets, `eval`, or dynamic function construction.
- The live Vercel project settings, Supabase schema/policies/bucket restrictions, OAuth provider settings, logs, and production HTTP headers remain outside this repository-only audit.

## Completion criteria

The critical privacy issue should be considered closed only when:

- Raw GPX and processed files remain inaccessible to anon and non-owner authenticated users, including for public activities.
- Every public route/stat payload is generated server-side from a privacy-safe representation.
- Feed, activity, leaderboard, analytics, comparison, map/image, and download paths use only that representation.
- Existing public data has been migrated and old raw-public policies/artifacts have been removed.
- Automated RLS/integration tests prove the owner/non-owner/anon access matrix.

The audit as a whole should be considered remediated only after the live database policies and deployment headers are verified in addition to passing repository tests, lint, type checking, and production build checks.
