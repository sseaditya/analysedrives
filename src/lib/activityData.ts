import { supabase } from "@/lib/supabase";
import {
  generateProcessedTrack,
  parseGPX,
  PROCESSED_TRACK_VERSION,
  type GPXPoint,
  type ProcessedTrack,
} from "@/utils/gpxParser";
import type { ActivitySummary, LoadedActivity } from "@/types/segments";
import {
  getPublicProcessedPath,
  isPublicProcessedTrack,
} from "@/utils/publicActivity";

export const ACTIVITY_SUMMARY_SELECT = "id, slug, user_id, title, file_path, created_at, public, speed_cap, hide_radius, stats, profiles:user_id(display_name, full_name, avatar_url, car)";

type JoinedProfile = NonNullable<ActivitySummary["profiles"]>;
type ActivityRow = Omit<ActivitySummary, "profiles"> & { profiles?: JoinedProfile | JoinedProfile[] | null };

function normalizeProfile(record: unknown): ActivitySummary {
  const row = record as ActivityRow;
  return {
    ...row,
    profiles: Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles ?? null,
  };
}

export async function fetchAccessibleActivities(userId: string): Promise<ActivitySummary[]> {
  const { data, error } = await supabase
    .from("activities")
    .select(ACTIVITY_SUMMARY_SELECT)
    .or(`public.eq.true,user_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(normalizeProfile);
}

export async function fetchActivitySummary(idOrSlug: string): Promise<ActivitySummary> {
  const query = supabase.from("activities").select(ACTIVITY_SUMMARY_SELECT);
  if (/^\d+$/.test(idOrSlug)) query.eq("slug", Number(idOrSlug));
  else query.eq("id", idOrSlug);
  const { data, error } = await query.single();
  if (error) throw error;
  return normalizeProfile(data);
}

function hydratePoints(track: ProcessedTrack): GPXPoint[] {
  return track.points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    ele: point.ele,
    time: point.time ? new Date(point.time) : undefined,
  }));
}

async function hydrateDownloadedTrack(activity: ActivitySummary, blob: Blob): Promise<LoadedActivity | null> {
  try {
    const parsed = JSON.parse(await blob.text()) as ProcessedTrack;
    if (parsed.version === PROCESSED_TRACK_VERSION && Array.isArray(parsed.points)) {
      return { activity, points: hydratePoints(parsed), processedTrack: parsed };
    }
  } catch (error) {
    console.warn("Invalid processed activity cache", error);
  }
  return null;
}

export async function loadActivityTrack(
  activity: ActivitySummary,
  viewerId?: string | null,
): Promise<LoadedActivity> {
  const isPublicViewer = activity.public && viewerId !== activity.user_id;

  if (isPublicViewer) {
    const publicPath = getPublicProcessedPath(activity.file_path);
    const { data: publicBlob, error: publicError } = await supabase.storage
      .from("gpx-files")
      .download(publicPath);

    if (!publicError && publicBlob) {
      const loaded = await hydrateDownloadedTrack(activity, publicBlob);
      if (loaded && isPublicProcessedTrack(loaded.processedTrack)) {
        return {
          ...loaded,
          activity: { ...activity, hide_radius: 0 },
        };
      }
    }
    console.warn("Public activity artifact unavailable; using legacy track fallback", activity.id);
  }

  const processedPath = activity.file_path.replace(/\.gpx$/i, "") + ".processed.json";
  const { data: processedBlob, error: processedError } = await supabase.storage
    .from("gpx-files")
    .download(processedPath);

  if (!processedError && processedBlob) {
    const loaded = await hydrateDownloadedTrack(activity, processedBlob);
    if (loaded) return loaded;
  }

  const { data: gpxBlob, error: gpxError } = await supabase.storage
    .from("gpx-files")
    .download(activity.file_path);
  if (gpxError || !gpxBlob) throw gpxError ?? new Error("Activity file is unavailable");

  const points = parseGPX(await gpxBlob.text());
  if (points.length < 2) throw new Error("Activity does not contain enough GPS points");
  return { activity, points, processedTrack: generateProcessedTrack(points) };
}
