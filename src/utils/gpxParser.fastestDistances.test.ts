import { describe, expect, it } from "vitest";
import { calculateFastestDistances, type GPXPoint } from "./gpxParser";

function buildTrack(speeds: number[]): GPXPoint[] {
  const points: GPXPoint[] = [{ lat: 0, lon: 0, time: new Date(0) }];
  let longitude = 0;
  let elapsedSeconds = 0;
  const oneKmInDegrees = 1 / 111.195;

  for (const speed of speeds) {
    longitude += oneKmInDegrees;
    elapsedSeconds += 3600 / speed;
    points.push({ lat: 0, lon: longitude, time: new Date(elapsedSeconds * 1000) });
  }
  return points;
}

describe("calculateFastestDistances", () => {
  it("finds the fastest exact consecutive distance window", () => {
    const efforts = calculateFastestDistances(buildTrack([
      ...Array(10).fill(60),
      ...Array(10).fill(120),
      ...Array(10).fill(60),
    ]), [10, 20, 50]);

    expect(efforts).toHaveLength(2);
    expect(efforts[0].distanceKm).toBe(10);
    expect(efforts[0].elapsedTime).toBeCloseTo(300, 0);
    expect(efforts[0].averageSpeed).toBeCloseTo(120, 0);
    expect(efforts[1].distanceKm).toBe(20);
    expect(efforts[1].elapsedTime).toBeCloseTo(900, 0);
  });

  it("does not join distance windows across recording gaps", () => {
    const points = buildTrack(Array(12).fill(60));
    points[7].time = new Date(points[6].time!.getTime() + 120_000);
    for (let i = 8; i < points.length; i++) {
      points[i].time = new Date(points[i - 1].time!.getTime() + 60_000);
    }

    expect(calculateFastestDistances(points, [10])).toEqual([]);
  });

  it("can start after a stationary pause without charging that pause", () => {
    const points = buildTrack(Array(20).fill(60));
    const stopped = { ...points[5], time: new Date(points[5].time!.getTime() + 120_000) };
    points.splice(6, 0, stopped);
    for (let i = 7; i < points.length; i++) {
      points[i].time = new Date(points[i].time!.getTime() + 120_000);
    }

    const [effort] = calculateFastestDistances(points, [10]);
    expect(effort.elapsedTime).toBeCloseTo(600, 0);
    expect(effort.averageSpeed).toBeCloseTo(60, 0);
  });
});
