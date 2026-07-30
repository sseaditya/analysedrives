import type {
  DriveComparisonSample,
  DriveComparisonTrack,
  DriveMapPoint,
  DriveMapSample,
  DriveTimelinePoint,
} from "@/types/driveComparison";
import type { LoadedActivity } from "@/types/segments";
import type { ActivitySummary } from "@/types/segments";
import type { SpeedBucket } from "@/utils/gpxParser";
import {
  clipPublicActivityPoints,
  DEFAULT_PUBLIC_HIDE_RADIUS,
  isLegacyPublicProcessedTrack,
  isPublicProcessedTrack,
} from "@/utils/publicActivity";

const MAX_MARKER_PULSE_HZ = 2.5;

export function canCompareActivities(
  source: ActivitySummary,
  target: ActivitySummary,
  viewerId: string,
) {
  return source.user_id === viewerId
    && source.id !== target.id
    && (target.user_id === viewerId || target.public);
}

function capSpeed(speed: number, cap: number | null) {
  return Math.min(cap ?? Infinity, Math.max(0, Number.isFinite(speed) ? speed : 0));
}

function cappedDistribution(distribution: SpeedBucket[] | undefined, cap: number | null) {
  const buckets = (distribution ?? []).map((bucket) => ({ ...bucket }));
  if (!cap || buckets.length === 0) return buckets;

  const visible = buckets.filter((bucket) => bucket.minSpeed < cap);
  const hidden = buckets.filter((bucket) => bucket.minSpeed >= cap);
  if (hidden.length === 0) return visible;

  const target = visible.at(-1);
  const hiddenTime = hidden.reduce((total, bucket) => total + bucket.time, 0);
  const hiddenDistance = hidden.reduce((total, bucket) => total + bucket.distance, 0);
  if (target) {
    target.time += hiddenTime;
    target.distance += hiddenDistance;
    return visible;
  }
  return [{ range: `0-${cap}`, minSpeed: 0, time: hiddenTime, distance: hiddenDistance }];
}

function fallbackTimeline(loaded: LoadedActivity, speedCap: number | null): DriveTimelinePoint[] {
  return loaded.processedTrack.points.map((point) => ({
    elapsed: point.elapsedTime,
    distance: point.distance,
    speed: capSpeed(point.speed, speedCap),
    elevation: point.ele ?? null,
  }));
}

function fallbackMapPoints(
  loaded: LoadedActivity,
  isOtherPublic: boolean,
  hideRadius: number,
): DriveMapPoint[] {
  const visiblePoints = isOtherPublic
    ? clipPublicActivityPoints(loaded.points, hideRadius)
    : loaded.points;
  if (visiblePoints.length === 0) return [];
  const sourceStart = Math.max(0, loaded.points.indexOf(visiblePoints[0]));
  return visiblePoints.map((point, index) => ({
    elapsed: loaded.processedTrack.points[sourceStart + index]?.elapsedTime ?? 0,
    lat: point.lat,
    lon: point.lon,
  }));
}

export function buildDriveComparisonTrack(
  loaded: LoadedActivity,
  viewerId: string,
): DriveComparisonTrack | null {
  const { activity, processedTrack } = loaded;
  const isOtherPublic = activity.public && activity.user_id !== viewerId;
  const currentPublic = isOtherPublic && isPublicProcessedTrack(processedTrack)
    ? processedTrack
    : null;
  const legacyPublic = isOtherPublic && isLegacyPublicProcessedTrack(processedTrack);
  const speedCap = isOtherPublic
    ? currentPublic?.speedCap ?? activity.speed_cap ?? null
    : null;

  const timeline: DriveTimelinePoint[] = currentPublic
    ? currentPublic.profilePoints.map((point) => ({
      elapsed: point.elapsedTime,
      distance: point.distance,
      speed: capSpeed(point.speed, speedCap),
      elevation: point.ele ?? null,
    }))
    : fallbackTimeline(loaded, speedCap);
  if (timeline.length < 2) return null;

  const hideRadius = currentPublic?.hideRadius
    ?? activity.hide_radius
    ?? DEFAULT_PUBLIC_HIDE_RADIUS;
  const mapPoints: DriveMapPoint[] = currentPublic
    ? loaded.points.map((point, index) => {
      const profile = currentPublic.profilePoints[currentPublic.visibleStartPointIndex + index];
      return {
        elapsed: profile?.elapsedTime ?? 0,
        lat: point.lat,
        lon: point.lon,
      };
    })
    : fallbackMapPoints(loaded, isOtherPublic, hideRadius);

  const duration = Math.max(0, timeline.at(-1)?.elapsed ?? 0);
  const distance = Math.max(0, timeline.at(-1)?.distance ?? 0);
  const firstMapElapsed = mapPoints[0]?.elapsed ?? 0;
  const lastMapElapsed = mapPoints.at(-1)?.elapsed ?? duration;
  const hideOutsideMapWindow = isOtherPublic
    && !legacyPublic
    && (firstMapElapsed > 0 || lastMapElapsed < duration);
  const averageSpeed = capSpeed(
    Number(processedTrack.stats.avgSpeed) || (duration > 0 ? distance / (duration / 3600) : 0),
    speedCap,
  );
  const maximumSpeed = capSpeed(
    Number(processedTrack.stats.maxSpeed)
      || timeline.reduce((maximum, point) => Math.max(maximum, point.speed), 0),
    speedCap,
  );

  return {
    activity,
    timeline,
    mapPoints,
    duration,
    distance,
    averageSpeed,
    maximumSpeed,
    speedDistribution: cappedDistribution(processedTrack.stats.speedDistribution, speedCap),
    privacyLimited: isOtherPublic && (hideRadius > 0 || mapPoints.length < timeline.length),
    hideOutsideMapWindow,
    legacyVisibleOnly: legacyPublic,
  };
}

function rightIndexAtElapsed<T extends { elapsed: number }>(points: T[], elapsed: number) {
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].elapsed < elapsed) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function sampleDriveAtElapsed(
  track: DriveComparisonTrack,
  elapsed: number,
): DriveComparisonSample {
  const points = track.timeline;
  const target = Math.max(0, elapsed);
  if (target <= points[0].elapsed) {
    return { ...points[0], elapsed: target, finished: false };
  }
  if (target >= track.duration) {
    const last = points.at(-1)!;
    return { ...last, elapsed: target, speed: 0, finished: true };
  }

  const right = rightIndexAtElapsed(points, target);
  const left = right - 1;
  const span = points[right].elapsed - points[left].elapsed;
  const ratio = span > 0 ? (target - points[left].elapsed) / span : 0;
  const leftElevation = points[left].elevation;
  const rightElevation = points[right].elevation;
  return {
    elapsed: target,
    distance: points[left].distance + (points[right].distance - points[left].distance) * ratio,
    speed: points[left].speed + (points[right].speed - points[left].speed) * ratio,
    elevation: leftElevation != null && rightElevation != null
      ? leftElevation + (rightElevation - leftElevation) * ratio
      : leftElevation ?? rightElevation,
    finished: false,
  };
}

export function sampleDriveMapAtElapsed(
  track: DriveComparisonTrack,
  elapsed: number,
): DriveMapSample | null {
  const points = track.mapPoints;
  if (points.length === 0) return null;
  const target = Math.max(0, elapsed);
  const first = points[0];
  const last = points.at(-1)!;
  if (track.hideOutsideMapWindow && (target < first.elapsed || target > last.elapsed)) return null;
  if (target <= first.elapsed) return { lat: first.lat, lon: first.lon };
  if (target >= last.elapsed) return { lat: last.lat, lon: last.lon };

  const right = rightIndexAtElapsed(points, target);
  const left = right - 1;
  const span = points[right].elapsed - points[left].elapsed;
  const ratio = span > 0 ? (target - points[left].elapsed) / span : 0;
  return {
    lat: points[left].lat + (points[right].lat - points[left].lat) * ratio,
    lon: points[left].lon + (points[right].lon - points[left].lon) * ratio,
  };
}

export function markerPulseDurationSeconds(speedKmh: number) {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return null;
  const frequency = Math.min(MAX_MARKER_PULSE_HZ, speedKmh / 60);
  return 1 / frequency;
}
