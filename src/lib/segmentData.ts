import { supabase } from "@/lib/supabase";
import { fetchAccessibleActivities, loadActivityTrack } from "@/lib/activityData";
import { indexSegmentEfforts } from "@/lib/segmentIndexing";
import { coarseSegmentCandidate, matchActivityToSegment, SEGMENT_EFFORT_ALGORITHM_VERSION } from "@/utils/segmentMatching";
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

async function calculateLiveMatches(segment: Segment, userId: string) {
  const activities = (await fetchAccessibleActivities(userId)).filter((activity) => coarseSegmentCandidate(segment, activity));
  const matches: SegmentLeaderboardEntry[] = [];
  let failures = 0;
  const concurrency = 4;
  for (let offset = 0; offset < activities.length; offset += concurrency) {
    const results = await Promise.allSettled(activities.slice(offset, offset + concurrency).map(async (activity) => {
      const loaded = await loadActivityTrack(activity);
      return matchActivityToSegment(segment, loaded, userId);
    }));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        matches.push({ ...result.value, rank: 0 });
      } else if (result.status === "rejected") {
        failures++;
        console.warn("Could not inspect segment candidate", result.reason);
      }
    }
  }
  matches.sort((a, b) => b.avgSpeed - a.avgSpeed || b.coverage - a.coverage);
  matches.forEach((match, index) => { match.rank = index + 1; });
  return { matches, failures, persisted: false as const };
}

export async function findSegmentMatches(segment: Segment, userId: string): Promise<{ matches: SegmentLeaderboardEntry[]; failures: number; persisted: boolean }> {
  try {
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
    return { matches, failures: 0, persisted: true };
  } catch (error) {
    console.warn("Persisted segment leaderboard unavailable; using live matching", error);
    return calculateLiveMatches(segment, userId);
  }
}

export async function loadLeaderboardMatch(entry: SegmentLeaderboardEntry): Promise<SegmentMatch> {
  const loadedActivity = entry.loadedActivity ?? await loadActivityTrack(entry.activity);
  return { ...entry, loadedActivity };
}
