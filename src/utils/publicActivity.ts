import {
  calculateStats,
  generateProcessedTrack,
  haversineDistance,
  PROCESSED_TRACK_VERSION,
  type GPXPoint,
  type ProcessedTrack,
} from "@/utils/gpxParser";

export const PUBLIC_PROCESSED_TRACK_VERSION = 2;
export const DEFAULT_PUBLIC_SPEED_CAP = 120;
export const DEFAULT_PUBLIC_HIDE_RADIUS = 5;

export interface PublicProcessedTrack extends ProcessedTrack {
  publicArtifactVersion: number;
  speedCap: number;
  hideRadius: number;
}

export function getPublicProcessedPath(gpxPath: string) {
  return gpxPath.replace(/\.gpx$/i, "") + ".public.processed.json";
}

export function isPublicProcessedTrack(value: unknown): value is PublicProcessedTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<PublicProcessedTrack>;
  return track.version === PROCESSED_TRACK_VERSION
    && track.publicArtifactVersion === PUBLIC_PROCESSED_TRACK_VERSION
    && Array.isArray(track.points)
    && track.points.length >= 2;
}

export function clipPublicActivityPoints(points: GPXPoint[], hideRadiusKm: number): GPXPoint[] {
  if (!Number.isFinite(hideRadiusKm) || hideRadiusKm <= 0 || points.length < 2) {
    return points.slice();
  }

  let distance = 0;
  let startIndex = 0;
  let foundStart = false;
  for (let index = 1; index < points.length; index++) {
    distance += haversineDistance(
      points[index - 1].lat,
      points[index - 1].lon,
      points[index].lat,
      points[index].lon,
    );
    if (distance >= hideRadiusKm) {
      startIndex = index;
      foundStart = true;
      break;
    }
  }

  distance = 0;
  let endIndex = points.length - 1;
  let foundEnd = false;
  for (let index = points.length - 2; index >= 0; index--) {
    distance += haversineDistance(
      points[index].lat,
      points[index].lon,
      points[index + 1].lat,
      points[index + 1].lon,
    );
    if (distance >= hideRadiusKm) {
      endIndex = index;
      foundEnd = true;
      break;
    }
  }

  return foundStart && foundEnd && startIndex < endIndex
    ? points.slice(startIndex, endIndex + 1)
    : [];
}

function cappedSpeedDistribution(
  distribution: ProcessedTrack["stats"]["speedDistribution"],
  speedCap: number,
) {
  if (!distribution?.length) return distribution;
  const visible = distribution
    .filter((bucket) => bucket.minSpeed < speedCap)
    .map((bucket) => ({ ...bucket }));
  const hidden = distribution.filter((bucket) => bucket.minSpeed >= speedCap);
  if (!hidden.length) return visible;

  const cappedTime = hidden.reduce((sum, bucket) => sum + bucket.time, 0);
  const cappedDistance = hidden.reduce((sum, bucket) => sum + bucket.distance, 0);
  const target = visible.at(-1);
  if (target) {
    target.time += cappedTime;
    target.distance += cappedDistance;
    return visible;
  }
  return [{
    range: `0-${speedCap}`,
    minSpeed: 0,
    time: cappedTime,
    distance: cappedDistance,
  }];
}

export function generatePublicProcessedTrack(
  sourcePoints: GPXPoint[],
  configuredSpeedCap?: number | null,
  configuredHideRadius?: number | null,
): PublicProcessedTrack {
  const speedCap = configuredSpeedCap && configuredSpeedCap > 0
    ? configuredSpeedCap
    : DEFAULT_PUBLIC_SPEED_CAP;
  const hideRadius = configuredHideRadius != null && configuredHideRadius >= 0
    ? configuredHideRadius
    : DEFAULT_PUBLIC_HIDE_RADIUS;
  const clipped = clipPublicActivityPoints(sourcePoints, hideRadius);
  const sourceStats = calculateStats(sourcePoints);
  const processed = generateProcessedTrack(clipped);

  const totalTime = sourceStats.avgSpeed > speedCap
    ? (sourceStats.totalDistance / speedCap) * 3600
    : sourceStats.totalTime;
  const movingTime = sourceStats.movingAvgSpeed > speedCap
    ? (sourceStats.totalDistance / speedCap) * 3600
    : sourceStats.movingTime;

  processed.points = processed.points.map((point) => ({
    ...point,
    speed: Math.min(speedCap, Math.max(0, point.speed)),
  }));
  processed.previewSpeeds = processed.previewSpeeds?.map((speed) => Math.min(speedCap, Math.max(0, speed)));
  processed.stats = {
    ...processed.stats,
    totalDistance: sourceStats.totalDistance,
    totalTime,
    movingTime,
    stoppedTime: Math.max(0, totalTime - movingTime),
    avgSpeed: Math.min(speedCap, Math.max(0, sourceStats.avgSpeed)),
    movingAvgSpeed: Math.min(speedCap, Math.max(0, sourceStats.movingAvgSpeed)),
    maxSpeed: Math.min(speedCap, Math.max(0, sourceStats.maxSpeed)),
    startTime: sourceStats.startTime,
    speedDistribution: cappedSpeedDistribution(sourceStats.speedDistribution, speedCap),
    fastestDistances: processed.stats.fastestDistances?.map((effort) => ({
      ...effort,
      averageSpeed: Math.min(speedCap, Math.max(0, effort.averageSpeed)),
      elapsedTime: Math.max(effort.elapsedTime, (effort.distanceKm / speedCap) * 3600),
    })),
  };

  return {
    ...processed,
    publicArtifactVersion: PUBLIC_PROCESSED_TRACK_VERSION,
    speedCap,
    hideRadius,
  };
}
