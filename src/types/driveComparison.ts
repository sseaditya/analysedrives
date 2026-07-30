import type { ActivitySummary } from "@/types/segments";
import type { SpeedBucket } from "@/utils/gpxParser";

export interface DriveTimelinePoint {
  elapsed: number;
  distance: number;
  speed: number;
  elevation: number | null;
}

export interface DriveMapPoint {
  elapsed: number;
  lat: number;
  lon: number;
}

export interface DriveComparisonTrack {
  activity: ActivitySummary;
  timeline: DriveTimelinePoint[];
  mapPoints: DriveMapPoint[];
  duration: number;
  distance: number;
  averageSpeed: number;
  maximumSpeed: number;
  speedDistribution: SpeedBucket[];
  privacyLimited: boolean;
  hideOutsideMapWindow: boolean;
  legacyVisibleOnly: boolean;
}

export interface DriveComparisonSample {
  elapsed: number;
  distance: number;
  speed: number;
  elevation: number | null;
  finished: boolean;
}

export interface DriveMapSample {
  lat: number;
  lon: number;
}
