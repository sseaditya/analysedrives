import { describe, expect, it } from "vitest";
import { calculateStats, haversineDistance, type GPXPoint } from "@/utils/gpxParser";
import {
  generatePublicProcessedTrack,
  getPublicProcessedPath,
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

  it("clips both ends without changing the retained coordinates or timestamps", () => {
    const cap = 40;
    const source = buildPoints();
    const artifact = generatePublicProcessedTrack(source, cap, 0.2);

    expect(isPublicProcessedTrack(artifact)).toBe(true);
    expect(artifact.points.length).toBeLessThan(30);
    expect(artifact.points.length).toBeGreaterThan(1);
    expect(artifact.stats.maxSpeed).toBeLessThanOrEqual(cap);
    expect(Math.max(...artifact.points.map((point) => point.speed))).toBeLessThanOrEqual(cap);

    const first = artifact.points[0];
    const sourceFirst = source.find((point) => point.lat === first.lat && point.lon === first.lon)!;
    expect(first.time).toBe(sourceFirst.time!.toISOString());

    const next = artifact.points[1];
    const seconds = (new Date(next.time!).getTime() - new Date(first.time!).getTime()) / 1000;
    const coordinateDerivedSpeed = haversineDistance(first.lat, first.lon, next.lat, next.lon) / seconds * 3600;
    expect(coordinateDerivedSpeed).toBeGreaterThan(cap);
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
