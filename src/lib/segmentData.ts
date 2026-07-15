import { supabase } from "@/lib/supabase";
import { fetchAccessibleActivities, fetchActivitySummary, loadActivityTrack } from "@/lib/activityData";
import { indexSegmentEfforts } from "@/lib/segmentIndexing";
import { matchActivityToSegment, segmentActivityCandidate, SEGMENT_EFFORT_ALGORITHM_VERSION } from "@/utils/segmentMatching";
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
  const accessible = await fetchAccessibleActivities(userId);
  if (segment.source_activity_id && !accessible.some((activity) => activity.id === segment.source_activity_id)) {
    try {
      const source = await fetchActivitySummary(segment.source_activity_id);
      if (source.user_id === userId || source.public) accessible.unshift(source);
    } catch (error) {
      console.warn("Could not load the segment's source activity metadata", error);
    }
  }
  const activities = accessible.filter((activity) => segmentActivityCandidate(segment, activity));
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
  return { matches, failures, persisted: false as const, initializationError: undefined as string | undefined };
}

async function fetchPersistedMatches(segmentId: string): Promise<SegmentLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("get_segment_leaderboard", { target_segment_id: segmentId });
  if (error) throw error;
  return ((data || []) as LeaderboardRow[]).map((row) => ({
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
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function savedMatchesAreComplete(segment: Segment, userId: string, matches: SegmentLeaderboardEntry[]) {
  if (matches.length === 0) return false;
  // Segment creation requires the source activity to belong to the creator.
  // A creator's saved leaderboard without that activity is therefore known to
  // be incomplete and must not suppress the original live matcher.
  if (segment.created_by === userId && segment.source_activity_id) {
    return matches.some((match) => match.activity.id === segment.source_activity_id);
  }
  return true;
}

export async function findSegmentMatches(segment: Segment, userId: string): Promise<{ matches: SegmentLeaderboardEntry[]; failures: number; persisted: boolean; initializationError?: string }> {
  const issues: string[] = [];

  // The saved leaderboard is only an acceleration layer. Trust it when the
  // server has completed the current algorithm; otherwise go straight to the
  // original live matcher that predates persisted segment efforts.
  if ((segment.efforts_algorithm_version || 0) >= SEGMENT_EFFORT_ALGORITHM_VERSION) {
    try {
      const matches = await fetchPersistedMatches(segment.id);
      if (savedMatchesAreComplete(segment, userId, matches)) return { matches, failures: 0, persisted: true };
    } catch (error) {
      issues.push(describeError(error));
      console.warn("Could not read saved segment leaderboard", error);
    }
  }

  // This is the original implementation: fetch every accessible activity,
  // load its track, and run the same client-side matcher used before the DB
  // transfer. Crucially, no server backfill blocks this correctness path.
  const live = await calculateLiveMatches(segment, userId);

  // Populate/repair the acceleration layer after live results are already
  // available. Do not make the user wait for a global backfill.
  if (live.matches.length > 0) {
    void indexSegmentEfforts({ segmentId: segment.id, force: true }).catch((error) => {
      console.warn("Could not refresh saved segment efforts in the background", error);
    });
  }
  const initializationError = issues[0]
    ?? (live.matches.length === 0 && live.failures > 0
      ? `${live.failures} accessible drive${live.failures === 1 ? "" : "s"} could not be loaded.`
      : undefined);
  return {
    ...live,
    failures: live.failures,
    initializationError,
  };
}

export async function loadLeaderboardMatch(entry: SegmentLeaderboardEntry): Promise<SegmentMatch> {
  const loadedActivity = entry.loadedActivity ?? await loadActivityTrack(entry.activity);
  return { ...entry, loadedActivity };
}
