import { describe, expect, it } from "vitest";
import {
  buildDriveComparisonTrack,
  canCompareActivities,
  markerPulseDurationSeconds,
  sampleDriveAtElapsed,
  sampleDriveMapAtElapsed,
} from "@/lib/driveComparison";
import type { ActivitySummary, LoadedActivity } from "@/types/segments";
import type { DriveComparisonTrack } from "@/types/driveComparison";
import { generatePublicProcessedTrack } from "@/utils/publicActivity";
import type { GPXPoint } from "@/utils/gpxParser";

function track(overrides: Partial<DriveComparisonTrack> = {}): DriveComparisonTrack {
  return {
    activity: {
      id: "drive",
      slug: null,
      user_id: "owner",
      title: "Drive",
      file_path: "owner/drive.gpx",
      created_at: "2026-01-01",
      public: false,
      speed_cap: null,
      hide_radius: null,
      stats: null,
    },
    timeline: [
      { elapsed: 0, distance: 0, speed: 20, elevation: 100 },
      { elapsed: 10, distance: 1, speed: 40, elevation: null },
      { elapsed: 20, distance: 3, speed: 60, elevation: 140 },
    ],
    mapPoints: [
      { elapsed: 0, lat: 17, lon: 78 },
      { elapsed: 20, lat: 19, lon: 80 },
    ],
    duration: 20,
    distance: 3,
    averageSpeed: 30,
    maximumSpeed: 60,
    speedDistribution: [],
    privacyLimited: false,
    hideOutsideMapWindow: false,
    legacyVisibleOnly: false,
    ...overrides,
  };
}

describe("whole-drive comparison sampling", () => {
  it("interpolates independent distance, speed, elevation, and coordinates by elapsed time", () => {
    const sample = sampleDriveAtElapsed(track(), 5);
    expect(sample.distance).toBeCloseTo(0.5);
    expect(sample.speed).toBeCloseTo(30);
    expect(sample.elevation).toBe(100);
    expect(sampleDriveMapAtElapsed(track(), 5)).toEqual({ lat: 17.5, lon: 78.5 });
  });

  it("holds a completed drive at its endpoint with zero speed", () => {
    const sample = sampleDriveAtElapsed(track(), 35);
    expect(sample.distance).toBe(3);
    expect(sample.speed).toBe(0);
    expect(sample.finished).toBe(true);
    expect(sampleDriveMapAtElapsed(track(), 35)).toEqual({ lat: 19, lon: 80 });
  });

  it("hides public markers outside their visible privacy window", () => {
    const publicTrack = track({
      mapPoints: [
        { elapsed: 5, lat: 17.5, lon: 78.5 },
        { elapsed: 15, lat: 18.5, lon: 79.5 },
      ],
      privacyLimited: true,
      hideOutsideMapWindow: true,
    });
    expect(sampleDriveMapAtElapsed(publicTrack, 4)).toBeNull();
    expect(sampleDriveMapAtElapsed(publicTrack, 10)).toEqual({ lat: 18, lon: 79 });
    expect(sampleDriveMapAtElapsed(publicTrack, 16)).toBeNull();
  });
});

describe("speed-proportional marker pulse", () => {
  it("is static at zero and proportional until the safety cap", () => {
    expect(markerPulseDurationSeconds(0)).toBeNull();
    expect(markerPulseDurationSeconds(30)).toBe(2);
    expect(markerPulseDurationSeconds(60)).toBe(1);
    expect(markerPulseDurationSeconds(120)).toBe(0.5);
    expect(markerPulseDurationSeconds(300)).toBe(0.4);
  });
});

describe("whole-drive comparison access and public privacy", () => {
  const activity = (id: string, owner: string, isPublic: boolean): ActivitySummary => ({
    id,
    slug: null,
    user_id: owner,
    title: id,
    file_path: `${owner}/${id}.gpx`,
    created_at: "2026-01-01",
    public: isPublic,
    speed_cap: 60,
    hide_radius: 0.2,
    stats: null,
  });

  it("requires an owned source and a distinct accessible target", () => {
    const source = activity("source", "viewer", false);
    expect(canCompareActivities(source, activity("mine", "viewer", false), "viewer")).toBe(true);
    expect(canCompareActivities(source, activity("public", "other", true), "viewer")).toBe(true);
    expect(canCompareActivities(source, activity("private", "other", false), "viewer")).toBe(false);
    expect(canCompareActivities(source, source, "viewer")).toBe(false);
    expect(canCompareActivities(activity("not-mine", "other", true), source, "viewer")).toBe(false);
  });

  it("keeps a public full timeline while exposing only its privacy-safe map window", () => {
    const points: GPXPoint[] = Array.from({ length: 40 }, (_, index) => ({
      lat: 17 + index * 0.001,
      lon: 78,
      ele: 500 + index,
      time: new Date(index * 1000),
    }));
    const publicArtifact = generatePublicProcessedTrack(points, 60, 0.2);
    const loaded: LoadedActivity = {
      activity: activity("public", "other", true),
      processedTrack: publicArtifact,
      points: publicArtifact.points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        time: point.time ? new Date(point.time) : undefined,
      })),
    };
    const comparison = buildDriveComparisonTrack(loaded, "viewer")!;

    expect(comparison.timeline).toHaveLength(points.length);
    expect(comparison.mapPoints.length).toBeLessThan(comparison.timeline.length);
    expect(comparison.hideOutsideMapWindow).toBe(true);
    expect(Math.max(...comparison.timeline.map((point) => point.speed))).toBeLessThanOrEqual(60);
    expect(sampleDriveMapAtElapsed(comparison, 0)).toBeNull();
  });
});
