import type {
  ActivitySummary,
  ComparisonSeries,
  LoadedActivity,
  RouteAlignment,
  Segment,
  SegmentGeometryPoint,
  SegmentMatch,
} from "@/types/segments";
import { calculateLimitedStats, calculateStats, haversineDistance, type GPXPoint } from "@/utils/gpxParser";

export const SEGMENT_SAMPLE_KM = 0.1;
export const SEGMENT_MATCH_TOLERANCE_KM = 0.25;
export const SEGMENT_MATCH_THRESHOLD = 0.8;

const MATCH_GRID_SIZE_DEGREES = 0.002;
const MATCH_GRID_SEARCH_RADIUS = 2;

type Sample = SegmentGeometryPoint & { sourceIndex: number; time?: Date };

function lerp(a: number, b: number, ratio: number) {
  return a + (b - a) * ratio;
}

export function cumulativeDistances(points: Pick<GPXPoint, "lat" | "lon">[]): number[] {
  const distances = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    distances[i] = distances[i - 1] + haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return distances;
}

export function privacyVisibleRange(points: GPXPoint[], hideRadius = 0): [number, number] {
  if (points.length < 2 || hideRadius <= 0) return [0, Math.max(0, points.length - 1)];
  const cumulative = cumulativeDistances(points);
  const total = cumulative[cumulative.length - 1];
  let start = cumulative.findIndex((distance) => distance >= hideRadius);
  if (start < 0) start = points.length - 1;
  let end = cumulative.findIndex((distance) => distance >= total - hideRadius);
  if (end < 0) end = points.length - 1;
  return start < end ? [start, end] : [0, -1];
}

export function extractSegmentGeometry(points: GPXPoint[], startIndex: number, endIndex: number): SegmentGeometryPoint[] {
  const start = Math.max(0, Math.min(startIndex, endIndex));
  const end = Math.min(points.length - 1, Math.max(startIndex, endIndex));
  return resamplePoints(points.slice(start, end + 1), SEGMENT_SAMPLE_KM).map(({ sourceIndex: _sourceIndex, time: _time, ...point }) => point);
}

function resamplePoints(points: GPXPoint[], spacingKm = SEGMENT_SAMPLE_KM): Sample[] {
  if (!points.length) return [];
  if (points.length === 1) return [{ lat: points[0].lat, lon: points[0].lon, ele: points[0].ele ?? null, distance: 0, sourceIndex: 0, time: points[0].time }];

  const distances = cumulativeDistances(points);
  const total = distances[distances.length - 1];
  const samples: Sample[] = [];
  let sourceIndex = 1;
  for (let target = 0; target < total; target += spacingKm) {
    while (sourceIndex < distances.length - 1 && distances[sourceIndex] < target) sourceIndex++;
    const left = Math.max(0, sourceIndex - 1);
    const span = distances[sourceIndex] - distances[left];
    const ratio = span > 0 ? (target - distances[left]) / span : 0;
    const leftTime = points[left].time?.getTime();
    const rightTime = points[sourceIndex].time?.getTime();
    samples.push({
      lat: lerp(points[left].lat, points[sourceIndex].lat, ratio),
      lon: lerp(points[left].lon, points[sourceIndex].lon, ratio),
      ele: points[left].ele != null && points[sourceIndex].ele != null ? lerp(points[left].ele!, points[sourceIndex].ele!, ratio) : points[left].ele ?? points[sourceIndex].ele ?? null,
      distance: target,
      sourceIndex: left,
      time: leftTime != null && rightTime != null ? new Date(lerp(leftTime, rightTime, ratio)) : points[left].time,
    });
  }
  const last = points[points.length - 1];
  samples.push({ lat: last.lat, lon: last.lon, ele: last.ele ?? null, distance: total, sourceIndex: points.length - 1, time: last.time });
  return samples;
}

function processedMatchingPoints(loaded: LoadedActivity): GPXPoint[] {
  return loaded.points.map((point, index) => {
    const processed = loaded.processedTrack.points[index];
    return {
      ...point,
      lat: Number.isFinite(processed?.smoothedLat) ? processed.smoothedLat : point.lat,
      lon: Number.isFinite(processed?.smoothedLon) ? processed.smoothedLon : point.lon,
    };
  });
}

function gridKey(lat: number, lon: number) {
  return `${Math.floor(lat / MATCH_GRID_SIZE_DEGREES)}:${Math.floor(lon / MATCH_GRID_SIZE_DEGREES)}`;
}

function nearbyKeys(lat: number, lon: number): string[] {
  const x = Math.floor(lat / MATCH_GRID_SIZE_DEGREES);
  const y = Math.floor(lon / MATCH_GRID_SIZE_DEGREES);
  const keys: string[] = [];
  for (let dx = -MATCH_GRID_SEARCH_RADIUS; dx <= MATCH_GRID_SEARCH_RADIUS; dx++) {
    for (let dy = -MATCH_GRID_SEARCH_RADIUS; dy <= MATCH_GRID_SEARCH_RADIUS; dy++) keys.push(`${x + dx}:${y + dy}`);
  }
  return keys;
}

function buildAlignment(segmentGeometry: SegmentGeometryPoint[], activitySamples: Sample[]): RouteAlignment | null {
  if (segmentGeometry.length < 2 || activitySamples.length < 2) return null;
  const grid = new Map<string, number[]>();
  activitySamples.forEach((point, index) => {
    const key = gridKey(point.lat, point.lon);
    const indices = grid.get(key) ?? [];
    indices.push(index);
    grid.set(key, indices);
  });

  const matches: { segmentIndex: number; activityIndex: number }[] = [];
  let lastActivityIndex = -1;
  for (let segmentIndex = 0; segmentIndex < segmentGeometry.length; segmentIndex++) {
    const point = segmentGeometry[segmentIndex];
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (const key of nearbyKeys(point.lat, point.lon)) {
      for (const candidateIndex of grid.get(key) ?? []) {
        if (candidateIndex < lastActivityIndex) continue;
        const candidate = activitySamples[candidateIndex];
        const distance = haversineDistance(point.lat, point.lon, candidate.lat, candidate.lon);
        if (distance <= SEGMENT_MATCH_TOLERANCE_KM && distance < bestDistance) {
          bestDistance = distance;
          bestIndex = candidateIndex;
        }
      }
    }
    if (bestIndex >= 0) {
      matches.push({ segmentIndex, activityIndex: bestIndex });
      lastActivityIndex = bestIndex;
    }
  }
  if (matches.length < 2) return null;

  let bestStart = 0;
  let bestEnd = 0;
  let runStart = 0;
  for (let i = 1; i < matches.length; i++) {
    const segmentGap = matches[i].segmentIndex - matches[i - 1].segmentIndex;
    const activityGap = matches[i].activityIndex - matches[i - 1].activityIndex;
    if (segmentGap > 3 || activityGap > 6) runStart = i;
    if (matches[i].segmentIndex - matches[runStart].segmentIndex > matches[bestEnd].segmentIndex - matches[bestStart].segmentIndex) {
      bestStart = runStart;
      bestEnd = i;
    }
  }
  const run = matches.slice(bestStart, bestEnd + 1);
  return {
    segmentStartIndex: run[0].segmentIndex,
    segmentEndIndex: run[run.length - 1].segmentIndex,
    activityStartIndex: run[0].activityIndex,
    activityEndIndex: run[run.length - 1].activityIndex,
    points: run,
  };
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function publicSpeedLimit(loaded: LoadedActivity, viewerId: string): number | null {
  if (loaded.activity.user_id === viewerId || !loaded.activity.public) return null;
  const privacyCap = positiveNumber(loaded.activity.speed_cap);
  const recordedTopSpeed = positiveNumber(loaded.activity.stats?.maxSpeed)
    ?? positiveNumber(loaded.processedTrack.stats.maxSpeed);
  const limits = [privacyCap, recordedTopSpeed].filter((value): value is number => value != null);
  return limits.length ? Math.min(...limits) : null;
}

function displayedMetrics(points: GPXPoint[], speedLimit: number | null) {
  const stats = calculateStats(points);
  if (!speedLimit) {
    return { distance: stats.totalDistance, elapsed: stats.totalTime, avgSpeed: stats.avgSpeed, maxSpeed: stats.maxSpeed };
  }
  const limited = calculateLimitedStats(points, speedLimit);
  return {
    distance: stats.totalDistance,
    elapsed: limited?.simulatedTime ?? stats.totalTime,
    avgSpeed: Math.min(limited?.newAvgSpeed ?? stats.avgSpeed, speedLimit),
    maxSpeed: Math.min(stats.maxSpeed, speedLimit),
  };
}

export function matchActivityToSegment(segment: Segment, loaded: LoadedActivity, viewerId: string): SegmentMatch | null {
  const isOwner = loaded.activity.user_id === viewerId;
  const range = !isOwner && loaded.activity.public
    ? privacyVisibleRange(loaded.points, loaded.activity.hide_radius ?? 0)
    : [0, loaded.points.length - 1] as [number, number];
  if (range[1] <= range[0]) return null;
  const visiblePoints = loaded.points.slice(range[0], range[1] + 1);
  const visibleMatchingPoints = processedMatchingPoints(loaded).slice(range[0], range[1] + 1);
  const samples = resamplePoints(visibleMatchingPoints);
  const alignment = buildAlignment(segment.geometry, samples);
  if (!alignment) return null;

  const coveredStart = Math.max(0, segment.geometry[alignment.segmentStartIndex].distance - SEGMENT_MATCH_TOLERANCE_KM);
  const coveredEnd = Math.min(segment.distance_km, segment.geometry[alignment.segmentEndIndex].distance + SEGMENT_MATCH_TOLERANCE_KM);
  const coveredDistance = Math.max(0, coveredEnd - coveredStart);
  const coverage = segment.distance_km > 0 ? coveredDistance / segment.distance_km : 0;
  if (coverage + 1e-6 < SEGMENT_MATCH_THRESHOLD) return null;

  const startSource = samples[alignment.activityStartIndex].sourceIndex;
  const endSource = samples[alignment.activityEndIndex].sourceIndex;
  const matchedPoints = visiblePoints.slice(startSource, Math.min(visiblePoints.length, endSource + 2));
  const metrics = displayedMetrics(matchedPoints, publicSpeedLimit(loaded, viewerId));
  const offsetAlignment: RouteAlignment = {
    ...alignment,
    activityStartIndex: startSource + range[0],
    activityEndIndex: endSource + range[0],
    points: alignment.points.map((point) => ({
      segmentIndex: point.segmentIndex,
      activityIndex: samples[point.activityIndex].sourceIndex + range[0],
    })),
  };
  return {
    activity: loaded.activity,
    loadedActivity: loaded,
    score: coverage,
    coverage,
    matchedDistance: metrics.distance || coveredDistance,
    elapsedTime: metrics.elapsed,
    avgSpeed: metrics.avgSpeed,
    maxSpeed: metrics.maxSpeed,
    alignment: offsetAlignment,
  };
}

function alignmentMap(alignment: RouteAlignment) {
  return new Map(alignment.points.map((point) => [point.segmentIndex, point.activityIndex]));
}

function speedAt(loaded: LoadedActivity, index: number, cap: number | null) {
  const speed = loaded.processedTrack.points[index]?.speed ?? 0;
  return Math.min(cap ?? Infinity, speed);
}

function processedElapsedBetween(loaded: LoadedActivity, startIndex: number, endIndex: number, cap: number | null) {
  let elapsed = 0;
  const start = Math.max(0, Math.min(startIndex, endIndex));
  const end = Math.min(loaded.processedTrack.points.length - 1, Math.max(startIndex, endIndex));
  for (let index = start + 1; index <= end; index++) {
    const previous = loaded.processedTrack.points[index - 1];
    const point = loaded.processedTrack.points[index];
    const seconds = point.elapsedTime - previous.elapsedTime;
    const distance = point.distance - previous.distance;
    if (seconds <= 0 || distance < 0) continue;
    const rawSpeed = distance / (seconds / 3600);
    elapsed += cap && rawSpeed > cap ? distance / cap * 3600 : seconds;
  }
  return elapsed;
}

export function buildComparisonSeries(segment: Segment, matchA: SegmentMatch, matchB: SegmentMatch, viewerId: string): ComparisonSeries | null {
  const start = Math.max(matchA.alignment.segmentStartIndex, matchB.alignment.segmentStartIndex);
  const end = Math.min(matchA.alignment.segmentEndIndex, matchB.alignment.segmentEndIndex);
  if (end <= start) return null;
  const mapA = alignmentMap(matchA.alignment);
  const mapB = alignmentMap(matchB.alignment);
  const points: ComparisonSeries["points"] = [];
  let elapsedA = 0;
  let elapsedB = 0;
  const capA = publicSpeedLimit(matchA.loadedActivity, viewerId);
  const capB = publicSpeedLimit(matchB.loadedActivity, viewerId);
  let previousIndexA: number | null = null;
  let previousIndexB: number | null = null;
  for (let segmentIndex = start; segmentIndex <= end; segmentIndex++) {
    const indexA = mapA.get(segmentIndex);
    const indexB = mapB.get(segmentIndex);
    if (indexA == null || indexB == null) continue;
    const pointA = matchA.loadedActivity.points[indexA];
    const pointB = matchB.loadedActivity.points[indexB];
    if (!pointA || !pointB) continue;
    const speedA = speedAt(matchA.loadedActivity, indexA, capA);
    const speedB = speedAt(matchB.loadedActivity, indexB, capB);
    if (points.length) {
      elapsedA += processedElapsedBetween(matchA.loadedActivity, previousIndexA!, indexA, capA);
      elapsedB += processedElapsedBetween(matchB.loadedActivity, previousIndexB!, indexB, capB);
    }
    points.push({
      segmentIndex,
      distance: segment.geometry[segmentIndex].distance - segment.geometry[start].distance,
      elevation: segment.geometry[segmentIndex].ele,
      pointA,
      pointB,
      speedA,
      speedB,
      elapsedA,
      elapsedB,
    });
    previousIndexA = indexA;
    previousIndexB = indexB;
  }
  if (points.length < 2) return null;
  return { startSegmentIndex: start, endSegmentIndex: end, distance: points[points.length - 1].distance, points };
}

export function segmentBounds(geometry: SegmentGeometryPoint[]) {
  return geometry.reduce((bounds, point) => ({
    minLat: Math.min(bounds.minLat, point.lat), minLon: Math.min(bounds.minLon, point.lon),
    maxLat: Math.max(bounds.maxLat, point.lat), maxLon: Math.max(bounds.maxLon, point.lon),
  }), { minLat: Infinity, minLon: Infinity, maxLat: -Infinity, maxLon: -Infinity });
}

export function coarseSegmentCandidate(segment: Segment, activity: ActivitySummary) {
  const preview = activity.stats?.previewCoordinates;
  if (!preview || preview.length < 2) return true;
  const expanded = 0.15;
  return preview.some(([lat, lon]) => lat >= segment.bounds.minLat - expanded && lat <= segment.bounds.maxLat + expanded && lon >= segment.bounds.minLon - expanded && lon <= segment.bounds.maxLon + expanded);
}
