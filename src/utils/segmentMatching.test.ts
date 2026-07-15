import { describe, expect, it } from "vitest";
import { applySpeedLimitToDistribution, calculateSpeedDistribution, generateProcessedTrack, type GPXPoint } from "@/utils/gpxParser";
import type { ActivitySummary, LoadedActivity, Segment } from "@/types/segments";
import { buildComparisonSeries, comparisonActivityPoints, comparisonSpeedDistribution, extractSegmentGeometry, matchActivityToSegment, privacyVisibleRange, segmentActivityCandidate, segmentBounds } from "@/utils/segmentMatching";

const KM_PER_LAT = 111.195;

function route(startKm: number, endKm: number, stepKm = 0.05, lon = 73.5, speedKmh = 60): GPXPoint[] {
  const direction = endKm >= startKm ? 1 : -1;
  const count = Math.floor(Math.abs(endKm - startKm) / stepKm);
  const startedAt = new Date("2026-01-01T00:00:00Z").getTime();
  return Array.from({ length: count + 1 }, (_, index) => {
    const distance = Math.min(Math.abs(endKm - startKm), index * stepKm);
    return {
      lat: 18 + (startKm + direction * distance) / KM_PER_LAT,
      lon,
      ele: 500 + distance,
      time: new Date(startedAt + distance / speedKmh * 3600_000),
    };
  });
}

function segmentFrom(points: GPXPoint[]): Segment {
  const geometry = extractSegmentGeometry(points, 0, points.length - 1);
  return {
    id: "segment", created_by: "owner", name: "Expressway", description: null,
    source_activity_id: "source", source_title: "Source", geometry,
    distance_km: geometry[geometry.length - 1].distance, bounds: segmentBounds(geometry), created_at: "2026-01-01",
  };
}

function loaded(points: GPXPoint[], overrides: Partial<ActivitySummary> = {}): LoadedActivity {
  const activity: ActivitySummary = {
    id: overrides.id ?? "drive", slug: null, user_id: overrides.user_id ?? "owner", title: overrides.title ?? "Drive",
    file_path: "owner/drive.gpx", created_at: "2026-01-01", public: overrides.public ?? true,
    speed_cap: overrides.speed_cap ?? null, hide_radius: overrides.hide_radius ?? 0, stats: overrides.stats ?? null,
  };
  return { activity, points, processedTrack: generateProcessedTrack(points) };
}

describe("segment extraction and matching", () => {
  it("always keeps the origin drive as a candidate even with stale migrated preview stats", () => {
    const segment = segmentFrom(route(0, 10));
    const source = loaded(route(0, 10), {
      id: "source",
      stats: { previewCoordinates: [[0, 0], [0.1, 0.1]] },
    }).activity;

    expect(segmentActivityCandidate(segment, source)).toBe(true);
  });

  it("matches a long drive with unrelated start and end points", () => {
    const segment = segmentFrom(route(10, 20));
    const match = matchActivityToSegment(segment, loaded(route(0, 30)), "owner");
    expect(match).not.toBeNull();
    expect(match!.coverage).toBeGreaterThan(0.98);
  });

  it("accepts GPS drift inside the road corridor", () => {
    const segment = segmentFrom(route(0, 10));
    const drifted = route(0, 10, 0.04, 73.5022);
    expect(matchActivityToSegment(segment, loaded(drifted), "owner")?.coverage).toBeGreaterThan(0.98);
  });

  it("rejects GPS drift beyond the 250 metre road corridor", () => {
    const segment = segmentFrom(route(0, 10));
    const drifted = route(0, 10, 0.04, 73.5025);
    expect(matchActivityToSegment(segment, loaded(drifted), "owner")).toBeNull();
  });

  it("rejects the reverse direction", () => {
    const segment = segmentFrom(route(0, 10));
    expect(matchActivityToSegment(segment, loaded(route(10, 0)), "owner")).toBeNull();
  });

  it("accepts approximately eighty percent and rejects a shorter portion", () => {
    const segment = segmentFrom(route(0, 10));
    expect(matchActivityToSegment(segment, loaded(route(0, 8.1)), "owner")).not.toBeNull();
    expect(matchActivityToSegment(segment, loaded(route(0, 7.5)), "owner")).toBeNull();
  });

  it("calculates and enforces public privacy trimming", () => {
    const points = route(0, 10);
    const [start, end] = privacyVisibleRange(points, 1);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeLessThan(points.length - 1);
    const segment = segmentFrom(route(0, 10));
    expect(matchActivityToSegment(segment, loaded(points, { user_id: "other", hide_radius: 1 }), "viewer")).not.toBeNull();
    expect(matchActivityToSegment(segment, loaded(points, { user_id: "other", hide_radius: 2 }), "viewer")).toBeNull();
  });

  it("applies public speed caps to leaderboard metrics", () => {
    const points = route(0, 10, 0.05, 73.5, 120);
    const segment = segmentFrom(points);
    const match = matchActivityToSegment(segment, loaded(points, { user_id: "other", speed_cap: 80 }), "viewer");
    expect(match).not.toBeNull();
    expect(match!.maxSpeed).toBeLessThanOrEqual(80);
    expect(match!.avgSpeed).toBeLessThanOrEqual(80);
  });

  it("uses the lower recorded top speed for public metrics and elapsed time", () => {
    const points = route(0, 10, 0.05, 73.5, 120);
    const segment = segmentFrom(points);
    const match = matchActivityToSegment(segment, loaded(points, {
      user_id: "other",
      speed_cap: 100,
      stats: { maxSpeed: 80 },
    }), "viewer");
    expect(match).not.toBeNull();
    expect(match!.maxSpeed).toBeLessThanOrEqual(80);
    expect(match!.avgSpeed).toBeLessThanOrEqual(80);
    expect(match!.elapsedTime).toBeGreaterThanOrEqual(match!.matchedDistance / 80 * 3600 - 1);
  });

  it("builds a common-distance comparison for two qualifying drives", () => {
    const segment = segmentFrom(route(0, 10));
    const a = matchActivityToSegment(segment, loaded(route(-2, 12, 0.05, 73.5, 70), { id: "a" }), "owner")!;
    const b = matchActivityToSegment(segment, loaded(route(-1, 11, 0.04, 73.5004, 90), { id: "b" }), "owner")!;
    const comparison = buildComparisonSeries(segment, a, b, "owner");
    expect(comparison).not.toBeNull();
    expect(comparison!.distance).toBeGreaterThan(9.5);
    expect(comparison!.points.some((point) => point.speedB > point.speedA)).toBe(true);
  });

  it("uses processed speeds and capped elapsed time in public comparisons", () => {
    const points = route(0, 10, 0.05, 73.5, 120);
    const segment = segmentFrom(points);
    const a = matchActivityToSegment(segment, loaded(points, { id: "a" }), "viewer")!;
    const b = matchActivityToSegment(segment, loaded(points, {
      id: "b",
      user_id: "other",
      speed_cap: 100,
      stats: { maxSpeed: 80 },
    }), "viewer")!;
    const comparison = buildComparisonSeries(segment, a, b, "viewer");
    expect(comparison).not.toBeNull();
    expect(Math.max(...comparison!.points.map((point) => point.speedB))).toBeLessThanOrEqual(80);
    expect(comparison!.points.at(-1)!.elapsedB).toBeGreaterThanOrEqual(comparison!.distance / 80 * 3600 - 1);
  });

  it("uses the exact Activity-page distribution for each common segment portion", () => {
    const segment = segmentFrom(route(0, 10));
    const a = matchActivityToSegment(segment, loaded(route(-2, 12, 0.05, 73.5, 70), { id: "a" }), "owner")!;
    const b = matchActivityToSegment(segment, loaded(route(-1, 11, 0.04, 73.5004, 90), { id: "b" }), "owner")!;
    const comparison = buildComparisonSeries(segment, a, b, "owner")!;
    const selectedActivityPoints = comparisonActivityPoints(comparison, a);

    expect(comparisonSpeedDistribution(comparison, a, "owner")).toEqual(
      calculateSpeedDistribution(selectedActivityPoints, 10),
    );
  });

  it("applies the same public speed-cap distribution transform as Activity", () => {
    const segment = segmentFrom(route(0, 10));
    const a = matchActivityToSegment(segment, loaded(route(0, 10, 0.05, 73.5, 120), {
      id: "a", user_id: "other", speed_cap: 80,
    }), "viewer")!;
    const b = matchActivityToSegment(segment, loaded(route(0, 10, 0.05, 73.5004, 90), { id: "b" }), "viewer")!;
    const comparison = buildComparisonSeries(segment, a, b, "viewer")!;
    const activityBuckets = calculateSpeedDistribution(comparisonActivityPoints(comparison, a), 10);

    expect(comparisonSpeedDistribution(comparison, a, "viewer")).toEqual(
      applySpeedLimitToDistribution(activityBuckets, 80),
    );
  });
});
