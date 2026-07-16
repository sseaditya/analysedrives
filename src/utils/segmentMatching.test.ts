import { describe, expect, it } from "vitest";
import { applySpeedLimitToDistribution, calculateSpeedDistribution, generateProcessedTrack, type GPXPoint } from "@/utils/gpxParser";
import type { ActivitySummary, LoadedActivity, Segment } from "@/types/segments";
import { buildAlignment, buildComparisonSeries, comparisonActivityPoints, comparisonSpeedDistribution, extractSegmentGeometry, matchActivityToSegment, privacyVisibleRange, segmentActivityCandidate, segmentBounds } from "@/utils/segmentMatching";

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

function withPause(points: GPXPoint[], startIndex: number, durationMinutes = 30): GPXPoint[] {
  return points.map((point, index) => ({
    ...point,
    time: index >= startIndex
      ? new Date(point.time!.getTime() + durationMinutes * 60_000)
      : point.time,
  }));
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

  it("keeps the paused source activity aligned across its full selected range", () => {
    const paused = withPause(route(0, 10, 0.05, 73.5, 60), 100);
    const segment = segmentFrom(paused);
    const match = matchActivityToSegment(segment, loaded(paused, { id: "source" }), "owner");

    expect(match).not.toBeNull();
    expect(match!.coverage).toBeGreaterThan(0.98);
    expect(match!.alignment.activityStartIndex).toBeLessThan(5);
    expect(match!.alignment.activityEndIndex).toBeGreaterThan(paused.length - 5);
  });

  it("does not collapse a covered section onto one nearest activity point", () => {
    const geometry = extractSegmentGeometry(route(0, 0.5, 0.05), 0, 10);
    const center = geometry[Math.floor(geometry.length / 2)];
    const clusteredSamples = geometry.map((_, index) => ({
      lat: center.lat,
      lon: center.lon,
      ele: center.ele,
      distance: index * 0.1,
      sourceIndex: index,
    }));
    const alignment = buildAlignment(geometry, clusteredSamples);

    expect(alignment).not.toBeNull();
    expect(alignment!.activityStartIndex).toBe(0);
    expect(alignment!.activityEndIndex).toBe(geometry.length - 1);
    expect(new Set(alignment!.points.map((point) => point.activityIndex)).size).toBe(alignment!.points.length);
  });

  it("prefers a continuous route over a closer dead-end candidate", () => {
    const geometry = extractSegmentGeometry(route(0, 1, 0.05), 0, 20);
    const continuousPass = geometry.map((point, index) => ({
      ...point,
      lon: point.lon + 0.001,
      sourceIndex: index,
    }));
    const closerDeadEnd = {
      ...geometry[0],
      distance: geometry.at(-1)!.distance + 0.1,
      sourceIndex: continuousPass.length,
    };
    const alignment = buildAlignment(geometry, [...continuousPass, closerDeadEnd]);

    expect(alignment).not.toBeNull();
    expect(alignment!.segmentStartIndex).toBe(0);
    expect(alignment!.segmentEndIndex).toBe(geometry.length - 1);
    expect(alignment!.activityStartIndex).toBe(0);
    expect(alignment!.activityEndIndex).toBe(continuousPass.length - 1);
  });

  it("accepts GPS drift inside the 500 metre road corridor away from the endpoints", () => {
    const segment = segmentFrom(route(0, 10));
    const drifted = route(0, 10, 0.04, 73.5).map((point, index, points) => ({
      ...point,
      lon: 73.5 + 0.0045 * Math.sin(Math.PI * index / (points.length - 1)),
    }));
    expect(matchActivityToSegment(segment, loaded(drifted), "owner")?.coverage).toBeGreaterThan(0.98);
  });

  it("requires both segment endpoints to match within 200 metres", () => {
    const segment = segmentFrom(route(0, 10));
    expect(matchActivityToSegment(segment, loaded(route(0, 10, 0.04, 73.5015)), "owner")).not.toBeNull();
    expect(matchActivityToSegment(segment, loaded(route(0, 10, 0.04, 73.5025)), "owner")).toBeNull();
  });

  it("rejects GPS drift beyond the 500 metre road corridor", () => {
    const segment = segmentFrom(route(0, 10));
    const drifted = route(0, 10, 0.04, 73.5055);
    expect(matchActivityToSegment(segment, loaded(drifted), "owner")).toBeNull();
  });

  it("can return a same-direction partial match for manual inclusion", () => {
    const segment = segmentFrom(route(0, 10));
    const partial = loaded(route(0, 5));
    expect(matchActivityToSegment(segment, partial, "owner")).toBeNull();
    expect(matchActivityToSegment(segment, partial, "owner", 0.5)?.coverage).toBeGreaterThanOrEqual(0.5);
  });

  it("rejects the reverse direction", () => {
    const segment = segmentFrom(route(0, 10));
    expect(matchActivityToSegment(segment, loaded(route(10, 0)), "owner")).toBeNull();
  });

  it("requires qualifying drives to reach both endpoints", () => {
    const segment = segmentFrom(route(0, 10));
    expect(matchActivityToSegment(segment, loaded(route(0, 8.1)), "owner")).toBeNull();
    expect(matchActivityToSegment(segment, loaded(route(0, 7)), "owner")).toBeNull();
  });

  it("calculates and enforces public privacy trimming", () => {
    const points = route(0, 10);
    const [start, end] = privacyVisibleRange(points, 1);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeLessThan(points.length - 1);
    const segment = segmentFrom(route(0, 10));
    expect(matchActivityToSegment(segment, loaded(points, { user_id: "other", hide_radius: 1 }), "viewer")).toBeNull();
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
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const comparison = buildComparisonSeries(segment, a, b, "viewer")!;
    const activityBuckets = calculateSpeedDistribution(comparisonActivityPoints(comparison, a), 10);

    expect(comparisonSpeedDistribution(comparison, a, "viewer")).toEqual(
      applySpeedLimitToDistribution(activityBuckets, 80),
    );
  });
});
