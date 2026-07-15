import type { GPXPoint, GPXStats, ProcessedTrack } from "../utils/gpxParser";

export interface SegmentGeometryPoint {
  lat: number;
  lon: number;
  ele: number | null;
  distance: number;
}

export interface SegmentBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface Segment {
  id: string;
  created_by: string;
  name: string;
  description: string | null;
  source_activity_id: string | null;
  source_title: string;
  geometry: SegmentGeometryPoint[];
  distance_km: number;
  bounds: SegmentBounds;
  efforts_algorithm_version?: number;
  efforts_indexed_at?: string | null;
  created_at: string;
  profiles?: {
    display_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
}

export interface ActivitySummary {
  id: string;
  slug: number | null;
  user_id: string;
  title: string;
  file_path: string;
  created_at: string;
  public: boolean;
  speed_cap: number | null;
  hide_radius: number | null;
  stats: (Partial<GPXStats> & { previewCoordinates?: [number, number][] }) | null;
  profiles?: {
    display_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
    car: string | null;
  } | null;
}

export interface LoadedActivity {
  activity: ActivitySummary;
  points: GPXPoint[];
  processedTrack: ProcessedTrack;
}

export interface RouteAlignmentPoint {
  segmentIndex: number;
  activityIndex: number;
}

export interface RouteAlignment {
  segmentStartIndex: number;
  segmentEndIndex: number;
  activityStartIndex: number;
  activityEndIndex: number;
  points: RouteAlignmentPoint[];
}

export interface SegmentMatch {
  activity: ActivitySummary;
  loadedActivity: LoadedActivity;
  score: number;
  coverage: number;
  matchedDistance: number;
  elapsedTime: number;
  avgSpeed: number;
  maxSpeed: number;
  alignment: RouteAlignment;
}

export type SegmentLeaderboardEntry = Omit<SegmentMatch, "loadedActivity"> & {
  rank: number;
  loadedActivity?: LoadedActivity;
};

export interface ComparisonPoint {
  segmentIndex: number;
  distance: number;
  elevation: number | null;
  pointA: GPXPoint;
  pointB: GPXPoint;
  speedA: number;
  speedB: number;
  elapsedA: number;
  elapsedB: number;
}

export interface ComparisonSeries {
  startSegmentIndex: number;
  endSegmentIndex: number;
  distance: number;
  points: ComparisonPoint[];
}
