import { describe, expect, it } from "vitest";
import { calculateStats, haversineDistance, type GPXPoint } from "@/utils/gpxParser";
import {
  generatePublicProcessedTrack,
  getPublicProcessedPath,
  isLegacyPublicProcessedTrack,
  isPublicProcessedTrack,
} from "@/utils/publicActivity";

function buildPoints(count = 30): GPXPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    lat: 17 + index * 0.001,
    lon: 78,
    time: new Date(index * 1000),
  }));
}

describe("public activity artifacts", () => {
  it("uses the dedicated public artifact suffix", () => {
    expect(getPublicProcessedPath("user/drive.gpx")).toBe("user/drive.public.processed.json");
  });

  it("recognizes the previous clipped artifact version as a safe legacy fallback", () => {
    const current = generatePublicProcessedTrack(buildPoints(), 120, 0.2);
    const legacy = {
      ...current,
      publicArtifactVersion: 2,
      profilePoints: undefined,
      visibleStartPointIndex: undefined,
      visibleEndPointIndex: undefined,
    };

    expect(isPublicProcessedTrack(legacy)).toBe(false);
    expect(isLegacyPublicProcessedTrack(legacy)).toBe(true);
  });

  it("clips both ends without changing the retained coordinates or timestamps", () => {
    const cap = 40;
    const source = buildPoints();
    const artifact = generatePublicProcessedTrack(source, cap, 0.2);

    expect(isPublicProcessedTrack(artifact)).toBe(true);
    expect(artifact.points.length).toBeLessThan(30);
    expect(artifact.points.length).toBeGreaterThan(1);
    expect(artifact.profilePoints).toHaveLength(source.length);
    expect(artifact.profilePoints.at(-1)?.distance).toBeCloseTo(calculateStats(source).totalDistance, 2);
    expect(artifact.visibleStartPointIndex).toBeGreaterThan(0);
    expect(artifact.visibleEndPointIndex).toBeLessThan(source.length - 1);
    expect(artifact.points[0].lat).toBe(source[artifact.visibleStartPointIndex].lat);
    expect(artifact.points.at(-1)?.lat).toBe(source[artifact.visibleEndPointIndex].lat);
    expect(artifact.stats.maxSpeed).toBeLessThanOrEqual(cap);
    expect(Math.max(...artifact.points.map((point) => point.speed))).toBeLessThanOrEqual(cap);
    expect(Math.max(...artifact.profilePoints.map((point) => point.speed))).toBeLessThanOrEqual(cap);
    expect(artifact.profilePoints.every((point) => !("lat" in point) && !("lon" in point))).toBe(true);

    const first = artifact.points[0];
    const sourceFirst = source.find((point) => point.lat === first.lat && point.lon === first.lon)!;
    expect(first.time).toBe(sourceFirst.time!.toISOString());

    const next = artifact.points[1];
    const seconds = (new Date(next.time!).getTime() - new Date(first.time!).getTime()) / 1000;
    const coordinateDerivedSpeed = haversineDistance(first.lat, first.lon, next.lat, next.lon) / seconds * 3600;
    expect(coordinateDerivedSpeed).toBeGreaterThan(cap);
  });

  it("regenerates clipped map points when the radius changes while preserving the full profile", () => {
    const source = buildPoints(100);
    const smallerRadius = generatePublicProcessedTrack(source, 120, 0.2);
    const largerRadius = generatePublicProcessedTrack(source, 120, 0.5);

    expect(largerRadius.points.length).toBeLessThan(smallerRadius.points.length);
    expect(largerRadius.visibleStartPointIndex).toBeGreaterThan(smallerRadius.visibleStartPointIndex);
    expect(largerRadius.visibleEndPointIndex).toBeLessThan(smallerRadius.visibleEndPointIndex);
    expect(largerRadius.profilePoints).toEqual(smallerRadius.profilePoints);
  });

  it("keeps a valid public artifact with an empty map when the radius hides the whole route", () => {
    const artifact = generatePublicProcessedTrack(buildPoints(10), 120, 50);

    expect(artifact.points).toEqual([]);
    expect(artifact.previewCoordinates).toEqual([]);
    expect(artifact.visibleStartPointIndex).toBe(-1);
    expect(artifact.visibleEndPointIndex).toBe(-1);
    expect(artifact.profilePoints).toHaveLength(10);
    expect(isPublicProcessedTrack(artifact)).toBe(true);
  });

  it("preserves aggregate times unless the corresponding average exceeds the cap", () => {
    const slow = buildPoints().map((point, index) => ({ ...point, time: new Date(index * 15_000) }));
    const slowStats = calculateStats(slow);
    const unchanged = generatePublicProcessedTrack(slow, 40, 0);
    expect(unchanged.stats.totalTime).toBeCloseTo(slowStats.totalTime, 6);
    expect(unchanged.stats.movingTime).toBeCloseTo(slowStats.movingTime, 6);

    const fast = buildPoints();
    const fastStats = calculateStats(fast);
    const capped = generatePublicProcessedTrack(fast, 40, 0);
    expect(capped.stats.totalTime).toBeCloseTo(fastStats.totalDistance / 40 * 3600, 6);
    expect(capped.stats.movingTime).toBeCloseTo(fastStats.totalDistance / 40 * 3600, 6);
  });
});
