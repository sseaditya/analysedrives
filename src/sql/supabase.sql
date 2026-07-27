-- DrivenStat canonical Supabase SQL
--
-- This file consolidates every Supabase SQL operation currently tracked in
-- this repository. It is safe to rerun after the application's base schema
-- already exists.
--
-- Prerequisites (created before SQL was tracked in this repository):
--   public.activities
--   public.profiles
--   storage bucket: gpx-files

-- ---------------------------------------------------------------------------
-- GPX storage access
-- ---------------------------------------------------------------------------

alter table storage.objects enable row level security;

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

drop policy if exists "Public Access to Public Processed Files" on storage.objects;
create policy "Public Access to Public Processed Files"
on storage.objects for select
using (
  bucket_id = 'gpx-files'
  and storage.objects.name like '%.public.processed.json'
  and exists (
    select 1
    from public.activities
    where public.activities.public = true
      and replace(public.activities.file_path, '.gpx', '.public.processed.json') = storage.objects.name
  )
);

drop policy if exists "Public Access to Public Files" on storage.objects;
create policy "Public Access to Public Files"
on storage.objects for select
using (
  bucket_id = 'gpx-files'
  and exists (
    select 1
    from public.activities
    where public.activities.file_path = storage.objects.name
      and public.activities.public = true
  )
);

drop policy if exists "Public Access to Processed Files" on storage.objects;
create policy "Public Access to Processed Files"
on storage.objects for select
using (
  bucket_id = 'gpx-files'
  and storage.objects.name like '%.processed.json'
  and exists (
    select 1
    from public.activities
    where public.activities.file_path = replace(storage.objects.name, '.processed.json', '.gpx')
      and public.activities.public = true
  )
);

-- ---------------------------------------------------------------------------
-- Public road comparison segments
-- ---------------------------------------------------------------------------

create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  source_activity_id uuid references public.activities(id) on delete set null,
  source_title text not null,
  geometry jsonb not null check (
    jsonb_typeof(geometry) = 'array'
    and jsonb_array_length(geometry) >= 2
  ),
  distance_km double precision not null check (distance_km > 0),
  bounds jsonb not null check (jsonb_typeof(bounds) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.segments
add column if not exists efforts_algorithm_version integer not null default 0;

alter table public.segments
add column if not exists efforts_indexed_at timestamptz;

create index if not exists segments_created_by_idx
on public.segments(created_by);

create index if not exists segments_created_at_idx
on public.segments(created_at desc);

alter table public.segments enable row level security;

create or replace function public.protect_segment_geometry()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.geometry is distinct from old.geometry
    or new.distance_km is distinct from old.distance_km
    or new.bounds is distinct from old.bounds
    or new.created_by is distinct from old.created_by
    or (
      new.source_activity_id is not null
      and new.source_activity_id is distinct from old.source_activity_id
    ) then
    raise exception 'Published segment geometry and ownership are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_segment_geometry_trigger on public.segments;
create trigger protect_segment_geometry_trigger
before update on public.segments
for each row execute function public.protect_segment_geometry();

drop policy if exists "Authenticated users can view public segments" on public.segments;
create policy "Authenticated users can view public segments"
on public.segments for select to authenticated
using (true);

drop policy if exists "Owners can create segments from their public activities" on public.segments;
create policy "Owners can create segments from their public activities"
on public.segments for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.activities
    where public.activities.id = source_activity_id
      and public.activities.user_id = auth.uid()
      and public.activities.public = true
  )
);

drop policy if exists "Owners can update segment metadata" on public.segments;
create policy "Owners can update segment metadata"
on public.segments for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "Owners can delete their segments" on public.segments;
create policy "Owners can delete their segments"
on public.segments for delete to authenticated
using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Persisted segment efforts
--
-- Raw and public-safe metrics live in the same protected row. Clients cannot
-- select this table directly; get_segment_leaderboard chooses the correct set
-- of metrics for the signed-in viewer.
-- ---------------------------------------------------------------------------

create table if not exists public.segment_efforts (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.segments(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  activity_user_id uuid not null references auth.users(id) on delete cascade,
  raw_score double precision not null,
  raw_coverage double precision not null,
  raw_matched_distance double precision not null,
  raw_elapsed_time double precision not null,
  raw_avg_speed double precision not null,
  raw_max_speed double precision not null,
  raw_alignment jsonb not null,
  public_score double precision,
  public_coverage double precision,
  public_matched_distance double precision,
  public_elapsed_time double precision,
  public_avg_speed double precision,
  public_max_speed double precision,
  public_alignment jsonb,
  algorithm_version integer not null,
  indexed_at timestamptz not null default now(),
  unique (segment_id, activity_id)
);

create index if not exists segment_efforts_segment_idx
on public.segment_efforts(segment_id);

create index if not exists segment_efforts_activity_idx
on public.segment_efforts(activity_id);

alter table public.segment_efforts enable row level security;

revoke all on public.segment_efforts from anon, authenticated;

create or replace function public.get_segment_leaderboard(target_segment_id uuid)
returns table (
  rank bigint,
  activity jsonb,
  score double precision,
  coverage double precision,
  matched_distance double precision,
  elapsed_time double precision,
  avg_speed double precision,
  max_speed double precision,
  alignment jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with visible_efforts as (
    select
      e.*,
      a.id as a_id,
      a.slug as a_slug,
      a.user_id as a_user_id,
      a.title as a_title,
      a.file_path as a_file_path,
      a.created_at as a_created_at,
      a.public as a_public,
      a.speed_cap as a_speed_cap,
      a.hide_radius as a_hide_radius,
      a.stats as a_stats,
      p.display_name,
      p.full_name,
      p.avatar_url,
      p.car,
      (a.user_id = auth.uid()) as is_owner
    from public.segment_efforts e
    join public.activities a on a.id = e.activity_id
    left join public.profiles p on p.id = a.user_id
    where e.segment_id = target_segment_id
      and (
        a.user_id = auth.uid()
        or (a.public = true and e.public_coverage is not null)
      )
  ), selected_metrics as (
    select
      *,
      case when is_owner then raw_score else public_score end as selected_score,
      case when is_owner then raw_coverage else public_coverage end as selected_coverage,
      case when is_owner then raw_matched_distance else public_matched_distance end as selected_distance,
      case when is_owner then raw_elapsed_time else public_elapsed_time end as selected_elapsed,
      case when is_owner then raw_avg_speed else public_avg_speed end as selected_avg,
      case when is_owner then raw_max_speed else public_max_speed end as selected_max,
      case when is_owner then raw_alignment else public_alignment end as selected_alignment
    from visible_efforts
  )
  select
    row_number() over (order by selected_avg desc, selected_coverage desc, indexed_at asc),
    jsonb_build_object(
      'id', a_id,
      'slug', a_slug,
      'user_id', a_user_id,
      'title', a_title,
      'file_path', a_file_path,
      'created_at', a_created_at,
      'public', a_public,
      'speed_cap', a_speed_cap,
      'hide_radius', a_hide_radius,
      'stats', a_stats,
      'profiles', jsonb_build_object(
        'display_name', display_name,
        'full_name', full_name,
        'avatar_url', avatar_url,
        'car', car
      )
    ),
    selected_score,
    selected_coverage,
    selected_distance,
    selected_elapsed,
    selected_avg,
    selected_max,
    selected_alignment
  from selected_metrics
  order by selected_avg desc, selected_coverage desc, indexed_at asc;
$$;

revoke all on function public.get_segment_leaderboard(uuid) from public;
grant execute on function public.get_segment_leaderboard(uuid) to authenticated;

drop function if exists public.get_activity_segment_ranks(uuid);

create function public.get_activity_segment_ranks(target_activity_id uuid)
returns table (
  segment_id uuid,
  segment_name text,
  rank bigint,
  total_rides bigint,
  coverage double precision,
  matched_distance double precision,
  elapsed_time double precision,
  avg_speed double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with visible_efforts as (
    select
      e.segment_id,
      e.activity_id,
      e.indexed_at,
      case when a.user_id = auth.uid() then e.raw_coverage else e.public_coverage end as selected_coverage,
      case when a.user_id = auth.uid() then e.raw_matched_distance else e.public_matched_distance end as selected_distance,
      case when a.user_id = auth.uid() then e.raw_elapsed_time else e.public_elapsed_time end as selected_elapsed,
      case when a.user_id = auth.uid() then e.raw_avg_speed else e.public_avg_speed end as selected_avg
    from public.segment_efforts e
    join public.activities a on a.id = e.activity_id
    where a.user_id = auth.uid()
      or (a.public = true and e.public_coverage is not null)
  ), ranked_efforts as (
    select
      visible_efforts.segment_id,
      visible_efforts.activity_id,
      visible_efforts.selected_coverage,
      visible_efforts.selected_distance,
      visible_efforts.selected_elapsed,
      visible_efforts.selected_avg,
      row_number() over (
        partition by visible_efforts.segment_id
        order by selected_avg desc, selected_coverage desc, indexed_at asc
      ) as effort_rank,
      count(*) over (partition by visible_efforts.segment_id) as total_rides
    from visible_efforts
  )
  select
    s.id,
    s.name,
    ranked_efforts.effort_rank,
    ranked_efforts.total_rides,
    ranked_efforts.selected_coverage,
    ranked_efforts.selected_distance,
    ranked_efforts.selected_elapsed,
    ranked_efforts.selected_avg
  from ranked_efforts
  join public.segments s on s.id = ranked_efforts.segment_id
  where ranked_efforts.activity_id = target_activity_id
  order by s.name asc;
$$;

revoke all on function public.get_activity_segment_ranks(uuid) from public;
grant execute on function public.get_activity_segment_ranks(uuid) to authenticated;
