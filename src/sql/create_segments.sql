create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  source_activity_id uuid references public.activities(id) on delete set null,
  source_title text not null,
  geometry jsonb not null check (jsonb_typeof(geometry) = 'array' and jsonb_array_length(geometry) >= 2),
  distance_km double precision not null check (distance_km > 0),
  bounds jsonb not null check (jsonb_typeof(bounds) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists segments_created_by_idx on public.segments(created_by);
create index if not exists segments_created_at_idx on public.segments(created_at desc);

alter table public.segments enable row level security;

create policy "Authenticated users can view public segments"
on public.segments for select to authenticated
using (true);

create policy "Owners can create segments from their public activities"
on public.segments for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.activities
    where activities.id = source_activity_id
      and activities.user_id = auth.uid()
      and activities.public = true
  )
);

create or replace function public.protect_segment_geometry()
returns trigger language plpgsql security invoker
set search_path = public
as $$
begin
  if new.geometry is distinct from old.geometry
    or new.distance_km is distinct from old.distance_km
    or new.bounds is distinct from old.bounds
    or new.created_by is distinct from old.created_by
    or (new.source_activity_id is not null and new.source_activity_id is distinct from old.source_activity_id) then
    raise exception 'Published segment geometry and ownership are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_segment_geometry_trigger on public.segments;
create trigger protect_segment_geometry_trigger before update on public.segments
for each row execute function public.protect_segment_geometry();

create policy "Owners can update segment metadata"
on public.segments for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "Owners can delete their segments"
on public.segments for delete to authenticated
using (created_by = auth.uid());
