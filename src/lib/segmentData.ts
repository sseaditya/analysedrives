import { supabase } from "@/lib/supabase";
import { loadActivityTrack } from "@/lib/activityData";
import { indexSegmentEfforts } from "@/lib/segmentIndexing";
import { SEGMENT_EFFORT_ALGORITHM_VERSION } from "@/utils/segmentMatching";
import type { ActivitySummary, RouteAlignment, Segment, SegmentLeaderboardEntry, SegmentMatch } from "@/types/segments";

function normalizeSegment(record: unknown): Segment {
  const row = record as Segment;
  return {
    ...row,
    geometry: Array.isArray(row.geometry) ? row.geometry : [],
    bounds: row.bounds ?? { minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 },
  };
}

async function attachCreators(segments: Segment[]): Promise<Segment[]> {
  const ids = [...new Set(segments.map((segment) => segment.created_by))];
  if (!ids.length) return segments;
  const { data } = await supabase.from("profiles").select("id, display_name, full_name, avatar_url").in("id", ids);
  const profiles = new Map((data ?? []).map((profile) => [profile.id, profile]));
  return segments.map((segment) => ({ ...segment, profiles: profiles.get(segment.created_by) ?? null }));
}

export async function fetchSegments(): Promise<Segment[]> {
  const { data, error } = await supabase.from("segments").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return attachCreators((data ?? []).map(normalizeSegment));
}

export async function fetchSegment(id: string): Promise<Segment> {
  const { data, error } = await supabase.from("segments").select("*").eq("id", id).single();
  if (error) throw error;
  return (await attachCreators([normalizeSegment(data)]))[0];
}

type LeaderboardRow = {
  rank: number | string;
  activity: ActivitySummary;
  score: number;
  coverage: number;
  matched_distance: number;
  elapsed_time: number;
  avg_speed: number;
  max_speed: number;
  alignment: RouteAlignment;
};

export async function findSegmentMatches(segment: Segment, _userId: string): Promise<{ matches: SegmentLeaderboardEntry[]; failures: number }> {
  if ((segment.efforts_algorithm_version || 0) < SEGMENT_EFFORT_ALGORITHM_VERSION) {
    await indexSegmentEfforts({ segmentId: segment.id });
  }
  const { data, error } = await supabase.rpc("get_segment_leaderboard", { target_segment_id: segment.id });
  if (error) throw error;
  const matches = ((data || []) as LeaderboardRow[]).map((row) => ({
    rank: Number(row.rank),
    activity: row.activity,
    score: row.score,
    coverage: row.coverage,
    matchedDistance: row.matched_distance,
    elapsedTime: row.elapsed_time,
    avgSpeed: row.avg_speed,
    maxSpeed: row.max_speed,
    alignment: row.alignment,
  }));
  return { matches, failures: 0 };
}

export async function loadLeaderboardMatch(entry: SegmentLeaderboardEntry): Promise<SegmentMatch> {
  const loadedActivity = entry.loadedActivity ?? await loadActivityTrack(entry.activity);
  return { ...entry, loadedActivity };
}
