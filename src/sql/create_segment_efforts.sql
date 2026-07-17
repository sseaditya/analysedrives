-- Apply after create_segments.sql. The canonical copy is also in supabase.sql.

alter table public.segments
add column if not exists efforts_algorithm_version integer not null default 0;

alter table public.segments
add column if not exists efforts_indexed_at timestamptz;

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

create index if not exists segment_efforts_segment_idx on public.segment_efforts(segment_id);
create index if not exists segment_efforts_activity_idx on public.segment_efforts(activity_id);
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
language sql stable security definer set search_path = public
as $$
  with visible_efforts as (
    select e.*, a.id a_id, a.slug a_slug, a.user_id a_user_id, a.title a_title,
      a.file_path a_file_path, a.created_at a_created_at, a.public a_public,
      a.speed_cap a_speed_cap, a.hide_radius a_hide_radius, a.stats a_stats,
      p.display_name, p.full_name, p.avatar_url, p.car,
      (a.user_id = auth.uid()) is_owner
    from public.segment_efforts e
    join public.activities a on a.id = e.activity_id
    left join public.profiles p on p.id = a.user_id
    where e.segment_id = target_segment_id
      and (a.user_id = auth.uid() or (a.public = true and e.public_coverage is not null))
  ), selected_metrics as (
    select *,
      case when is_owner then raw_score else public_score end selected_score,
      case when is_owner then raw_coverage else public_coverage end selected_coverage,
      case when is_owner then raw_matched_distance else public_matched_distance end selected_distance,
      case when is_owner then raw_elapsed_time else public_elapsed_time end selected_elapsed,
      case when is_owner then raw_avg_speed else public_avg_speed end selected_avg,
      case when is_owner then raw_max_speed else public_max_speed end selected_max,
      case when is_owner then raw_alignment else public_alignment end selected_alignment
    from visible_efforts
  )
  select
    row_number() over (order by selected_avg desc, selected_coverage desc, indexed_at asc),
    jsonb_build_object(
      'id', a_id, 'slug', a_slug, 'user_id', a_user_id, 'title', a_title,
      'file_path', a_file_path, 'created_at', a_created_at, 'public', a_public,
      'speed_cap', a_speed_cap, 'hide_radius', a_hide_radius, 'stats', a_stats,
      'profiles', jsonb_build_object('display_name', display_name, 'full_name', full_name, 'avatar_url', avatar_url, 'car', car)
    ),
    selected_score, selected_coverage, selected_distance, selected_elapsed,
    selected_avg, selected_max, selected_alignment
  from selected_metrics
  order by selected_avg desc, selected_coverage desc, indexed_at asc;
$$;

revoke all on function public.get_segment_leaderboard(uuid) from public;
grant execute on function public.get_segment_leaderboard(uuid) to authenticated;

create or replace function public.get_activity_segment_ranks(target_activity_id uuid)
returns table (segment_id uuid, segment_name text, rank bigint)
language sql stable security definer set search_path = public
as $$
  with visible_efforts as (
    select e.segment_id, e.activity_id, e.indexed_at,
      case when a.user_id = auth.uid() then e.raw_coverage else e.public_coverage end selected_coverage,
      case when a.user_id = auth.uid() then e.raw_avg_speed else e.public_avg_speed end selected_avg
    from public.segment_efforts e
    join public.activities a on a.id = e.activity_id
    where a.user_id = auth.uid() or (a.public = true and e.public_coverage is not null)
  ), ranked_efforts as (
    select visible_efforts.segment_id, visible_efforts.activity_id,
      row_number() over (partition by visible_efforts.segment_id order by selected_avg desc, selected_coverage desc, indexed_at asc) effort_rank
    from visible_efforts
  )
  select s.id, s.name, ranked_efforts.effort_rank
  from ranked_efforts
  join public.segments s on s.id = ranked_efforts.segment_id
  where ranked_efforts.activity_id = target_activity_id
  order by s.name asc;
$$;

revoke all on function public.get_activity_segment_ranks(uuid) from public;
grant execute on function public.get_activity_segment_ranks(uuid) to authenticated;
