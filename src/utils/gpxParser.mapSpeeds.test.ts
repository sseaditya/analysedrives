import { describe, expect, it } from "vitest";
import { analyzeSegments, resolvePreviewSpeeds, type GPXPoint } from "./gpxParser";

describe("map speed rendering", () => {
  it("keeps pause segments aligned with their original point pairs", () => {
    const points: GPXPoint[] = [
      { lat: 0, lon: 0, time: new Date(0) },
      { lat: 0, lon: 0.001, time: new Date(10_000) },
      { lat: 0, lon: 0.101, time: new Date(1_210_000) },
      { lat: 0, lon: 0.102, time: new Date(1_220_000) },
    ];

    const segments = analyzeSegments(points);

    expect(segments).toHaveLength(points.length - 1);
    expect(segments[1].speed).toBe(0);
    expect(segments[2].speed).toBeGreaterThan(0);
  });

  it("forces an outlying GPS jump to the lowest speed color", () => {
    const coordinates: [number, number][] = [
      [0, 0],
      [0, 0.01],
      [0, 0.02],
      [0, 0.03],
      [0, 0.13],
      [0, 0.14],
    ];

    expect(resolvePreviewSpeeds(coordinates, [40, 45, 50, 180, 55])).toEqual([40, 45, 50, 0, 55]);
    expect(resolvePreviewSpeeds(coordinates, undefined, 50)[3]).toBe(0);
  });
});
