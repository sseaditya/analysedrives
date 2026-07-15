import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySummary, LoadedActivity, Segment, SegmentMatch } from "@/types/segments";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchAccessibleActivities: vi.fn(),
  fetchActivitySummary: vi.fn(),
  loadActivityTrack: vi.fn(),
  indexSegmentEfforts: vi.fn(),
  segmentActivityCandidate: vi.fn(() => true),
  matchActivityToSegment: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

vi.mock("@/lib/activityData", () => ({
  fetchAccessibleActivities: mocks.fetchAccessibleActivities,
  fetchActivitySummary: mocks.fetchActivitySummary,
  loadActivityTrack: mocks.loadActivityTrack,
}));

vi.mock("@/lib/segmentIndexing", () => ({
  indexSegmentEfforts: mocks.indexSegmentEfforts,
}));

vi.mock("@/utils/segmentMatching", () => ({
  SEGMENT_EFFORT_ALGORITHM_VERSION: 1,
  segmentActivityCandidate: mocks.segmentActivityCandidate,
  matchActivityToSegment: mocks.matchActivityToSegment,
}));

import { findSegmentMatches } from "@/lib/segmentData";

const segment: Segment = {
  id: "segment-1",
  created_by: "owner-1",
  name: "Test road",
  description: null,
  source_activity_id: "base-drive",
  source_title: "Base drive",
  geometry: [
    { lat: 18.5, lon: 73.8, ele: null, distance: 0 },
    { lat: 18.6, lon: 73.9, ele: null, distance: 1 },
  ],
  distance_km: 1,
  bounds: { minLat: 18.5, minLon: 73.8, maxLat: 18.6, maxLon: 73.9 },
  efforts_algorithm_version: 1,
  created_at: "2026-07-15T00:00:00.000Z",
};

function activity(id: string, userId: string, isPublic: boolean): ActivitySummary {
  return {
    id,
    slug: null,
    user_id: userId,
    title: id,
    file_path: `${userId}/${id}.gpx`,
    created_at: "2026-07-15T00:00:00.000Z",
    public: isPublic,
    speed_cap: null,
    hide_radius: 0,
    stats: null,
    profiles: null,
  };
}

function persistedRow(item: ActivitySummary, avgSpeed = 50) {
  return {
    rank: 1,
    activity: item,
    score: 1,
    coverage: 1,
    matched_distance: 1,
    elapsed_time: 72,
    avg_speed: avgSpeed,
    max_speed: avgSpeed + 10,
    alignment: {
      segmentStartIndex: 0,
      segmentEndIndex: 1,
      activityStartIndex: 0,
      activityEndIndex: 1,
      points: [
        { segmentIndex: 0, activityIndex: 0 },
        { segmentIndex: 1, activityIndex: 1 },
      ],
    },
  };
}

function liveMatch(loaded: LoadedActivity, avgSpeed: number): SegmentMatch {
  const row = persistedRow(loaded.activity, avgSpeed);
  return {
    activity: loaded.activity,
    loadedActivity: loaded,
    score: row.score,
    coverage: row.coverage,
    matchedDistance: row.matched_distance,
    elapsedTime: row.elapsed_time,
    avgSpeed: row.avg_speed,
    maxSpeed: row.max_speed,
    alignment: row.alignment,
  };
}

describe("findSegmentMatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.segmentActivityCandidate.mockReturnValue(true);
    mocks.fetchAccessibleActivities.mockResolvedValue([]);
    mocks.fetchActivitySummary.mockRejectedValue(new Error("not found"));
    mocks.indexSegmentEfforts.mockResolvedValue({ ok: true, checked: 0, matched: 0, failures: 0 });
  });

  it("runs the original live matcher immediately when a completed index is empty", async () => {
    const base = activity("base-drive", "owner-1", true);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.fetchAccessibleActivities.mockResolvedValue([base]);
    mocks.loadActivityTrack.mockResolvedValue({
      activity: base,
      points: [],
      processedTrack: { version: 4, points: [], stats: {}, previewCoordinates: [] },
    });
    mocks.matchActivityToSegment.mockImplementation((_segment: Segment, loaded: LoadedActivity) => liveMatch(loaded, 45));

    const result = await findSegmentMatches(segment, "owner-1");

    expect(mocks.indexSegmentEfforts).toHaveBeenCalledWith({ segmentId: segment.id, force: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(result.persisted).toBe(false);
    expect(result.matches.map((match) => match.activity.id)).toEqual(["base-drive"]);
  });

  it("uses a complete saved leaderboard as the fast path", async () => {
    const base = activity("base-drive", "owner-1", true);
    mocks.rpc.mockResolvedValue({ data: [persistedRow(base)], error: null });

    const result = await findSegmentMatches(segment, "owner-1");

    expect(result.persisted).toBe(true);
    expect(mocks.fetchAccessibleActivities).not.toHaveBeenCalled();
    expect(mocks.indexSegmentEfforts).not.toHaveBeenCalled();
    expect(result.matches[0].activity.id).toBe("base-drive");
  });

  it("rejects a creator cache that is missing its origin drive", async () => {
    const base = activity("base-drive", "owner-1", true);
    const other = activity("public-drive", "owner-2", true);
    mocks.rpc.mockResolvedValue({ data: [persistedRow(other)], error: null });
    mocks.fetchAccessibleActivities.mockResolvedValue([base, other]);
    mocks.loadActivityTrack.mockImplementation(async (item: ActivitySummary) => ({
      activity: item,
      points: [],
      processedTrack: { version: 4, points: [], stats: {}, previewCoordinates: [] },
    }));
    mocks.matchActivityToSegment.mockImplementation((_segment: Segment, loaded: LoadedActivity) => liveMatch(loaded, 45));

    const result = await findSegmentMatches(segment, "owner-1");

    expect(result.persisted).toBe(false);
    expect(result.matches.map((match) => match.activity.id)).toContain("base-drive");
  });

  it("uses the original live matcher for the base, owned private, and public drives when the saved index stays empty", async () => {
    const drives = [
      activity("base-drive", "owner-1", true),
      activity("private-drive", "owner-1", false),
      activity("public-drive", "owner-2", true),
    ];
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.fetchAccessibleActivities.mockResolvedValue(drives);
    mocks.loadActivityTrack.mockImplementation(async (item: ActivitySummary) => ({
      activity: item,
      points: [],
      processedTrack: { version: 4, points: [], stats: {}, previewCoordinates: [] },
    }));
    mocks.matchActivityToSegment.mockImplementation((_segment: Segment, loaded: LoadedActivity) => {
      const speeds: Record<string, number> = { "base-drive": 45, "private-drive": 60, "public-drive": 52 };
      return liveMatch(loaded, speeds[loaded.activity.id]);
    });

    const result = await findSegmentMatches(segment, "owner-1");

    expect(mocks.fetchAccessibleActivities).toHaveBeenCalledWith("owner-1");
    expect(result.persisted).toBe(false);
    expect(result.matches.map((match) => match.activity.id)).toEqual([
      "private-drive",
      "public-drive",
      "base-drive",
    ]);
    expect(result.matches.map((match) => match.rank)).toEqual([1, 2, 3]);
  });

  it("still returns live matches when the background cache refresh throws", async () => {
    const base = activity("base-drive", "owner-1", true);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.indexSegmentEfforts.mockRejectedValue(new Error("old service key rejected"));
    mocks.fetchAccessibleActivities.mockResolvedValue([base]);
    mocks.loadActivityTrack.mockResolvedValue({
      activity: base,
      points: [],
      processedTrack: { version: 4, points: [], stats: {}, previewCoordinates: [] },
    });
    mocks.matchActivityToSegment.mockImplementation((_segment: Segment, loaded: LoadedActivity) => liveMatch(loaded, 45));

    const result = await findSegmentMatches(segment, "owner-1");

    expect(result.matches[0].activity.id).toBe("base-drive");
    expect(result.persisted).toBe(false);
  });

  it("fetches the origin drive explicitly when the accessible list omits it", async () => {
    const base = activity("base-drive", "owner-1", true);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.fetchAccessibleActivities.mockResolvedValue([]);
    mocks.fetchActivitySummary.mockResolvedValue(base);
    mocks.loadActivityTrack.mockResolvedValue({
      activity: base,
      points: [],
      processedTrack: { version: 4, points: [], stats: {}, previewCoordinates: [] },
    });
    mocks.matchActivityToSegment.mockImplementation((_segment: Segment, loaded: LoadedActivity) => liveMatch(loaded, 45));

    const result = await findSegmentMatches(segment, "owner-1");

    expect(mocks.fetchActivitySummary).toHaveBeenCalledWith("base-drive");
    expect(result.matches[0].activity.id).toBe("base-drive");
  });
});
