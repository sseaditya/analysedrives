import { supabase } from "@/lib/supabase";
import { fetchAccessibleActivities, loadActivityTrack } from "@/lib/activityData";
import { coarseSegmentCandidate, matchActivityToSegment } from "@/utils/segmentMatching";
import type { Segment, SegmentMatch } from "@/types/segments";

function normalizeSegment(record: unknown): Segment {
  const row = record as Segment;
  return {
    ...row,
    geometry: Array.isArray(row.geometry) ? row.geometry : [],
    bounds: row.bounds ?? {},
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

export async function findSegmentMatches(segment: Segment, userId: string): Promise<{ matches: SegmentMatch[]; failures: number }> {
  const activities = (await fetchAccessibleActivities(userId)).filter((activity) => coarseSegmentCandidate(segment, activity));
  const matches: SegmentMatch[] = [];
  let failures = 0;
  const concurrency = 4;
  for (let offset = 0; offset < activities.length; offset += concurrency) {
    const results = await Promise.allSettled(activities.slice(offset, offset + concurrency).map(async (activity) => {
      const loaded = await loadActivityTrack(activity);
      return matchActivityToSegment(segment, loaded, userId);
    }));
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        if (result.value) matches.push(result.value);
      } else {
        failures++;
        console.warn("Could not inspect segment candidate", result.reason);
      }
    });
  }
  matches.sort((a, b) => b.avgSpeed - a.avgSpeed || b.coverage - a.coverage);
  return { matches, failures };
}
