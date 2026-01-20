export interface GPXPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: Date;
}

// --- CONFIGURATION CONSTANTS ---
export const SPEED_SMOOTHING_WINDOW = 5;
export const ACCEL_SMOOTHING_WINDOW = 3; // Unified from 5/3 to 3 for responsiveness

// Thresholds
export const STOP_SPEED_THRESHOLD = 3.0; // km/h
export const HARD_ACCEL_THRESHOLD = 2.5; // m/s^2
export const HARD_BRAKE_THRESHOLD = -3.0; // m/s^2
export const CRUISING_THRESHOLD = 0.4;   // m/s^2 (±0.4 is cruising)

// Gap Filtering
export const MAX_VALID_GAP_PERCENTILE = 0.90; // Ignore acceleration on top 10% time gaps
export const MIN_GAP_DURATION = 5.0; // Only filter if gap is > 5 seconds
export const GAP_BUFFER_SECONDS = 10.0; // Ignore events ±10s around large gaps (Reduced from 30s)
export const CANCELLATION_WINDOW = 30.0; // Cancel Accel/Brake pairs within 30s

// Turn Detection Thresholds
export const MIN_TURN_DISTANCE = 0.015; // km (15 meters) - minimum distance for a turn to be considered real
export const TIGHT_TURN_ANGLE = 60; // degrees - angle threshold for tight turn
export const HAIRPIN_ANGLE = 135; // degrees - angle threshold for hairpin
export const TURN_DENSITY_THRESHOLD = 0.6; // deg/meter - minimum sharpness for turn classification
export const NET_HEADING_CHANGE_MIN = 30; // degrees - minimum net heading change to avoid zig-zag false positives
export const MICRO_JITTER_THRESHOLD = 1.0; // degrees - ignore bearing changes smaller than this
export const STRAIGHT_SECTION_THRESHOLD = 5; // degrees - bearing change under this is considered straight
export const STRAIGHT_FLUSH_DISTANCE = 0.025; // km - distance of straight travel to flush pending turn
export const MIN_STRAIGHT_SECTION = 0.02; // km - minimum distance to count as straight section

// Speed & Distance Thresholds
export const MAX_SPEED_CAP = 200; // km/h - sanity cap for max speed
export const MIN_DISTANCE_FOR_BEARING = 0.002; // km - minimum distance to calculate bearing
export const MIN_DISTANCE_FOR_GRADIENT = 0.001; // km - minimum distance for gradient calculation
export const MIN_DISTANCE_FOR_STEEP = 0.005; // km - minimum distance for steep grade calculation
export const MIN_ELEVATION_FOR_STEEP = 0.5; // meters - minimum elevation change for steep grade

// Gradient Classification
export const CLIMBING_GRADE = 1.0; // % grade threshold for climbing
export const DESCENDING_GRADE = -1.0; // % grade threshold for descending

// Smoothing Window Sizes
export const COORDINATE_SMOOTHING_WINDOW = 5;
export const ELEVATION_SMOOTHING_WINDOW = 5;
export const GRADIENT_SMOOTHING_WINDOW = 5;
export const SPEED_MOVING_AVG_WINDOW = 5;

export interface GPXStats {
  totalDistance: number; // in kilometers
  totalTime: number; // in seconds
  movingTime: number; // in seconds
  stoppedTime: number; // in seconds
  stopCount: number;
  avgSpeed: number; // in km/h (Total Avg)
  movingAvgSpeed: number; // in km/h (Moving Avg)
  maxSpeed: number; // in km/h
  elevationGain: number; // in meters
  pointCount: number;
  stopPoints?: [number, number][];
  // Motion Metrics
  hardAccelerationCount: number;
  hardBrakingCount: number;
  timeAccelerating: number; // seconds
  timeBraking: number;      // seconds
  timeCruising: number;     // seconds
  accelBrakeRatio: number;
  turbulenceScore: number;
  startTime?: Date;
  // Elevation Metrics
  elevationLoss: number;
  maxElevation: number;
  minElevation: number;
  steepestClimb: number; // percentage
  steepestDescent: number; // percentage
  timeClimbing: number; // seconds
  timeDescending: number; // seconds
  timeLevel: number; // seconds
  hillinessScore: number;
  climbDistance: number; // km
  // Geometry Metrics
  totalHeadingChange: number;
  tightTurnsCount: number;
  hairpinCount: number;
  twistinessScore: number;
  longestStraightSection: number; // km
  medianStraightLength: number; // km
  percentStraight: number;
  tightTurnPoints?: [number, number][];
  hairpinPoints?: [number, number][]; // Added hairpin points
  hardAccelPoints?: [number, number, number][]; // [lat, lon, m/s²]
  hardBrakePoints?: [number, number, number][]; // [lat, lon, m/s²]
  speedDistribution?: SpeedBucket[];
}


export interface SpeedBucket {
  range: string;
  minSpeed: number;
  time: number; // minutes
  distance: number; // km
}

// Haversine formula to calculate distance between two GPS points
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

function getPercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(percentile * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function calculateSpeedDistribution(points: GPXPoint[], bucketSize: number = 10): SpeedBucket[] {
  if (points.length < 2) return [];

  // We rely on calculateRobustSpeeds which is defined later in the file
  // However, for distribution we can do a simplified calculation or call it if hoisted.
  // Functions are hoisted.
  const robustSegments = calculateRobustSpeeds(points);
  const speeds = robustSegments.map(s => s.speed);

  // Smooth Speeds
  const WINDOW_SIZE = 5;
  const smoothedSpeeds: number[] = [];

  for (let i = 0; i < speeds.length; i++) {
    let sum = 0;
    let count = 0;
    const offset = Math.floor(WINDOW_SIZE / 2);

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < speeds.length) {
        sum += speeds[idx];
        count++;
      }
    }
    smoothedSpeeds.push(count > 0 ? sum / count : 0);
  }

  // Bucketize
  const buckets: Record<number, { time: number; distance: number }> = {};
  let maxBucketIndex = 0;

  robustSegments.forEach((seg, i) => {
    const speed = smoothedSpeeds[i];
    if (speed < 0.1) return; // Ignore stops

    const bucketIndex = Math.floor(speed / bucketSize) * bucketSize;
    if (!buckets[bucketIndex]) {
      buckets[bucketIndex] = { time: 0, distance: 0 };
    }
    buckets[bucketIndex].time += seg.time / 60; // minutes
    buckets[bucketIndex].distance += seg.distance;

    if (bucketIndex > maxBucketIndex) maxBucketIndex = bucketIndex;
  });

  const result: SpeedBucket[] = [];
  let foundValidTop = false;

  for (let i = maxBucketIndex; i >= 0; i -= bucketSize) {
    const data = buckets[i] || { time: 0, distance: 0 };
    const durationSeconds = data.time * 60;

    if (!foundValidTop) {
      if (durationSeconds >= 20) {
        foundValidTop = true;
      } else {
        continue;
      }
    }

    result.unshift({
      range: `${i}-${i + bucketSize}`,
      minSpeed: i,
      time: Number(data.time.toFixed(2)),
      distance: Number(data.distance.toFixed(2))
    });
  }

  return result;
}

export function parseGPX(gpxContent: string): GPXPoint[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxContent, "text/xml");

  const points: GPXPoint[] = [];
  let trackpoints = xmlDoc.getElementsByTagName("trkpt");
  if (trackpoints.length === 0) trackpoints = xmlDoc.getElementsByTagName("wpt");
  if (trackpoints.length === 0) trackpoints = xmlDoc.getElementsByTagName("rtept");

  for (let i = 0; i < trackpoints.length; i++) {
    const point = trackpoints[i];
    const lat = parseFloat(point.getAttribute("lat") || "0");
    const lon = parseFloat(point.getAttribute("lon") || "0");
    const eleElement = point.getElementsByTagName("ele")[0];
    const timeElement = point.getElementsByTagName("time")[0];

    points.push({
      lat,
      lon,
      ele: eleElement ? parseFloat(eleElement.textContent || "0") : undefined,
      time: timeElement ? new Date(timeElement.textContent || "") : undefined,
    });
  }
  return points;
}

// --- SHARED FILTERING LOGIC ---
interface FilterResult {
  finalAccelerations: number[];
  hardAccelPoints: [number, number, number][];
  hardBrakePoints: [number, number, number][];
  hardAccelerationCount: number;
  hardBrakingCount: number;
}

function applyAdvancedFiltering(
  smoothedAccelerations: number[],
  timeDeltas: number[],
  points: GPXPoint[],
  isClampedArray: boolean[]
): FilterResult {
  const finalAccelerations = [...smoothedAccelerations];
  let hardAccelerationCount = 0;
  let hardBrakingCount = 0;
  const hardAccelPoints: [number, number, number][] = [];
  const hardBrakePoints: [number, number, number][] = [];

  const invalidIndices = new Set<number>();
  const p95TimeGap = getPercentile(timeDeltas, MAX_VALID_GAP_PERCENTILE);
  let currentTimeIterator = 0;

  const timeMap = timeDeltas.map(t => {
    const start = currentTimeIterator;
    currentTimeIterator += t;
    return { start, mid: start + t / 2, end: currentTimeIterator };
  });

  // 1. Identify Invalid Regions
  for (let i = 0; i < timeDeltas.length; i++) {
    const time = timeDeltas[i];
    const isLargeGap = time > p95TimeGap && time > MIN_GAP_DURATION;
    const isClamped = isClampedArray[i];

    if (isLargeGap || isClamped) {
      invalidIndices.add(i);
      const gapTime = timeMap[i].mid;
      for (let j = 0; j < timeMap.length; j++) {
        if (invalidIndices.has(j)) continue;
        if (Math.abs(timeMap[j].mid - gapTime) <= GAP_BUFFER_SECONDS) {
          invalidIndices.add(j);
        }
      }
    }
  }

  // 2. Candidates
  interface CandidateEvent {
    index: number;
    type: 'ACCEL' | 'BRAKE';
    time: number;
    lat: number;
    lon: number;
    magnitude: number;
  }
  let candidateEvents: CandidateEvent[] = [];

  for (let i = 0; i < finalAccelerations.length; i++) {
    if (invalidIndices.has(i)) {
      finalAccelerations[i] = 0;
      continue;
    }
    const val = finalAccelerations[i];
    const t = timeMap[i].end;

    if (val > HARD_ACCEL_THRESHOLD) {
      const p = points[i + 1];
      if (p) candidateEvents.push({ index: i, type: 'ACCEL', time: t, lat: p.lat, lon: p.lon, magnitude: val });
    } else if (val < HARD_BRAKE_THRESHOLD) {
      const p = points[i + 1];
      if (p) candidateEvents.push({ index: i, type: 'BRAKE', time: t, lat: p.lat, lon: p.lon, magnitude: Math.abs(val) });
    }
  }

  // 3. Cluster Brakes
  const brakeEvents = candidateEvents.filter(e => e.type === 'BRAKE');
  const processedBrakeEvents: CandidateEvent[] = [];
  if (brakeEvents.length > 0) {
    let currentCluster: CandidateEvent[] = [brakeEvents[0]];
    const CLUSTER_WINDOW = 30.0;
    for (let i = 1; i < brakeEvents.length; i++) {
      const prev = currentCluster[currentCluster.length - 1];
      const curr = brakeEvents[i];
      if (curr.time - prev.time <= CLUSTER_WINDOW) {
        currentCluster.push(curr);
      } else {
        const maxEvent = currentCluster.reduce((max, e) => e.magnitude > max.magnitude ? e : max, currentCluster[0]);
        processedBrakeEvents.push(maxEvent);
        currentCluster = [curr];
      }
    }
    if (currentCluster.length > 0) {
      const maxEvent = currentCluster.reduce((max, e) => e.magnitude > max.magnitude ? e : max, currentCluster[0]);
      processedBrakeEvents.push(maxEvent);
    }
  }

  // 4. Cancellation
  const accelEvents = candidateEvents.filter(e => e.type === 'ACCEL');
  const accelFlags = new Array(accelEvents.length).fill(true);
  const brakeFlags = new Array(processedBrakeEvents.length).fill(true);

  for (let i = 0; i < accelEvents.length; i++) {
    for (let j = 0; j < processedBrakeEvents.length; j++) {
      if (!accelFlags[i] || !brakeFlags[j]) continue;
      const tDiff = Math.abs(accelEvents[i].time - processedBrakeEvents[j].time);
      if (tDiff <= CANCELLATION_WINDOW) {
        accelFlags[i] = false;
        brakeFlags[j] = false;
        finalAccelerations[accelEvents[i].index] = 0;
        finalAccelerations[processedBrakeEvents[j].index] = 0;
        break;
      }
    }
  }

  // 5. Output
  for (let i = 0; i < accelEvents.length; i++) {
    if (accelFlags[i]) {
      hardAccelerationCount++;
      hardAccelPoints.push([accelEvents[i].lat, accelEvents[i].lon, accelEvents[i].magnitude]);
    } else {
      finalAccelerations[accelEvents[i].index] = 0;
    }
  }
  for (let i = 0; i < processedBrakeEvents.length; i++) {
    if (brakeFlags[i]) {
      hardBrakingCount++;
      hardBrakePoints.push([processedBrakeEvents[i].lat, processedBrakeEvents[i].lon, processedBrakeEvents[i].magnitude]);
    } else {
      finalAccelerations[processedBrakeEvents[i].index] = 0;
    }
  }

  const keptBrakeIndices = new Set(processedBrakeEvents.map(e => e.index));
  brakeEvents.forEach(e => {
    if (!keptBrakeIndices.has(e.index)) {
      finalAccelerations[e.index] = 0;
    }
  });

  return { finalAccelerations, hardAccelPoints, hardBrakePoints, hardAccelerationCount, hardBrakingCount };
}

export function calculateStats(points: GPXPoint[]): GPXStats {
  const emptyStats: GPXStats = {
    totalDistance: 0,
    totalTime: 0,
    movingTime: 0,
    stoppedTime: 0,
    stopCount: 0,
    avgSpeed: 0,
    movingAvgSpeed: 0,
    maxSpeed: 0,
    elevationGain: 0,
    pointCount: points.length,
    hardAccelerationCount: 0,
    hardBrakingCount: 0,
    timeAccelerating: 0,
    timeBraking: 0,
    timeCruising: 0,
    accelBrakeRatio: 0,
    turbulenceScore: 0,
    elevationLoss: 0,
    maxElevation: 0,
    minElevation: 0,
    steepestClimb: 0,
    steepestDescent: 0,
    timeClimbing: 0,
    timeDescending: 0,
    timeLevel: 0,
    hillinessScore: 0,
    climbDistance: 0,
    totalHeadingChange: 0,
    tightTurnsCount: 0,
    hairpinCount: 0,
    twistinessScore: 0,
    longestStraightSection: 0,
    medianStraightLength: 0,
    percentStraight: 0,
  };

  if (points.length < 2) return emptyStats;

  let totalDistance = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let maxElevation = -Infinity;
  let minElevation = Infinity;
  let steepestClimb = 0;
  let steepestDescent = 0;
  let timeClimbing = 0;
  let timeDescending = 0;
  let timeLevel = 0;
  let climbDistance = 0;
  let maxSpeed = 0;
  let lastBearing: number | null = null;
  let totalHeadingChange = 0;
  let tightTurnsCount = 0;
  let hairpinCount = 0;
  let currentStraightDist = 0;
  const straightSections: number[] = [];
  let totalStraightDistance = 0;
  const tightTurnPoints: [number, number][] = [];
  const hairpinPoints: [number, number][] = [];
  const speeds: number[] = [];
  const timeDeltas: number[] = [];

  // Turn Detection State
  let currentTurnSum = 0;
  let currentTurnDistance = 0;
  let currentTurnPeak = { index: -1, delta: 0, lat: 0, lon: 0 };

  if (points[0].ele !== undefined) {
    maxElevation = points[0].ele;
    minElevation = points[0].ele;
  }

  let currentTurnStartBearing: number | null = null;

  // Coordinate Smoothing (5-point SMA)
  // To reduce "stray points" that cause fake turns and flatten wiggles
  const smoothedPoints = points.map((p, i) => {
    const window = COORDINATE_SMOOTHING_WINDOW;
    const offset = Math.floor(window / 2);
    let latSum = 0, lonSum = 0, count = 0;

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < points.length) {
        latSum += points[idx].lat;
        lonSum += points[idx].lon;
        count++;
      }
    }

    return {
      ...p,
      lat: count > 0 ? latSum / count : p.lat,
      lon: count > 0 ? lonSum / count : p.lon
    };
  });

  const robustSegments = calculateRobustSpeeds(points); // Speeds use raw points for safety? Or should use smoothed?
  // Let's keep speeds on raw points to capture acceleration physics, but use smoothed for BEARING.
  const isClampedArray = robustSegments.map(s => s.isClamped);

  const elevationWindow = ELEVATION_SMOOTHING_WINDOW;
  const smoothedElevations: (number | undefined)[] = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].ele === undefined) { smoothedElevations.push(undefined); continue; }
    let sum = 0, count = 0;
    const offset = Math.floor(elevationWindow / 2);
    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < points.length && points[idx].ele !== undefined) {
        sum += points[idx].ele!;
        count++;
      }
    }
    smoothedElevations.push(count > 0 ? sum / count : points[i].ele);
  }

  const rawGradients: number[] = [];
  for (let i = 0; i < robustSegments.length; i++) {
    const { speed, time: timeDiff, distance } = robustSegments[i];
    // Use SMOOTHED points for Bearing calculation
    const prev = smoothedPoints[i];
    const curr = smoothedPoints[i + 1];

    totalDistance += distance;
    speeds.push(speed);
    timeDeltas.push(timeDiff);

    const prevEle = smoothedElevations[i];
    const currEle = smoothedElevations[i + 1];
    if (prevEle !== undefined && currEle !== undefined) {
      const eleDiff = currEle - prevEle;
      if (eleDiff > 0) elevationGain += eleDiff;
      else if (eleDiff < 0) elevationLoss += Math.abs(eleDiff);

      if (distance > MIN_DISTANCE_FOR_GRADIENT) {
        rawGradients.push((eleDiff / (distance * 1000)) * 100);
      } else {
        rawGradients.push(0);
      }
      if (currEle > maxElevation) maxElevation = currEle;
      if (currEle < minElevation) minElevation = currEle;

      if (distance > MIN_DISTANCE_FOR_STEEP && Math.abs(eleDiff) > MIN_ELEVATION_FOR_STEEP) {
        const grad = (eleDiff / (distance * 1000)) * 100;
        if (grad > steepestClimb) steepestClimb = grad;
        if (grad < steepestDescent) steepestDescent = grad;
      }
    } else {
      rawGradients.push(0);
    }

    // Geometry Calculation (Rotation)
    // Updated Logic: Check Moving Average Speed > STOP_SPEED_THRESHOLD (Hysteresis)
    let isMoving = false;
    if (speeds.length > 0) {
      const window = SPEED_MOVING_AVG_WINDOW;
      let sum = 0;
      let count = 0;
      for (let k = 0; k < window; k++) {
        if (speeds.length - 1 - k >= 0) {
          sum += speeds[speeds.length - 1 - k];
          count++;
        }
      }
      const avgSpeed = count > 0 ? sum / count : 0;
      isMoving = avgSpeed > STOP_SPEED_THRESHOLD;
    }

    if (distance > MIN_DISTANCE_FOR_BEARING && isMoving) {
      const bearing = calculateBearing(prev.lat, prev.lon, curr.lat, curr.lon);
      if (lastBearing !== null) {
        let delta = bearing - lastBearing;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        // Total Heading Change (Absolute)
        totalHeadingChange += Math.abs(delta);

        // --- ROBUST TURN DETECTION ---
        const isTurnContinuation = (
          (currentTurnSum === 0) || // Fresh start
          (Math.sign(delta) === Math.sign(currentTurnSum)) || // Same direction
          (Math.abs(delta) < 10 && Math.abs(currentTurnSum) > 30) // Minor jitter during a major turn is allowed
        );

        if (Math.abs(delta) > MICRO_JITTER_THRESHOLD) { // Ignore micro-jitters
          if (isTurnContinuation) {
            if (currentTurnSum === 0) currentTurnStartBearing = lastBearing; // Capture start bearing
            currentTurnSum += delta;
            currentTurnDistance += distance;
            // Update Peak for Marker Placement (Center of the action)
            if (Math.abs(delta) > Math.abs(currentTurnPeak.delta)) {
              currentTurnPeak = { index: i, delta: delta, lat: curr.lat, lon: curr.lon };
            }
          } else {
            // Direction FLIP -> End previous turn, process it, start new one

            if (currentTurnDistance > MIN_TURN_DISTANCE) {
              // SHARPNESS CHECK:
              // 1. Angle Threshold: Reverted to TIGHT_TURN_ANGLE degrees (User Request)
              // 2. Density Threshold: Turn must be sharp (e.g. > TURN_DENSITY_THRESHOLD deg/meter)
              // 3. Zig-Zag Filter: Net Heading Change must be > NET_HEADING_CHANGE_MIN degrees
              const turnDensity = Math.abs(currentTurnSum) / (currentTurnDistance * 1000 || 1);

              let netHeadingChange = 360;
              if (currentTurnStartBearing !== null) {
                let rawChange = bearing - currentTurnStartBearing;
                if (rawChange > 180) rawChange -= 360;
                if (rawChange < -180) rawChange += 360;
                netHeadingChange = Math.abs(rawChange);
              }

              if (Math.abs(currentTurnSum) > TIGHT_TURN_ANGLE && turnDensity > TURN_DENSITY_THRESHOLD && netHeadingChange > NET_HEADING_CHANGE_MIN) {
                tightTurnsCount++;
                if (Math.abs(currentTurnSum) > HAIRPIN_ANGLE) {
                  hairpinCount++;
                  hairpinPoints.push([currentTurnPeak.lat, currentTurnPeak.lon]);
                } else {
                  tightTurnPoints.push([currentTurnPeak.lat, currentTurnPeak.lon]);
                }
              }
            }

            currentTurnSum = delta;
            currentTurnStartBearing = lastBearing; // Start new turn
            currentTurnDistance = distance;
            currentTurnPeak = { index: i, delta: delta, lat: curr.lat, lon: curr.lon };
          }
        } else {
          if (Math.abs(currentTurnSum) > 0) {
            currentTurnDistance += distance;
          }
        }

        // Straight Section Logic
        if (Math.abs(delta) < STRAIGHT_SECTION_THRESHOLD) { // < 5 degrees is effectively straight
          currentStraightDist += distance;

          // --- FLUSH TURN ON STRAIGHT ---
          if (currentStraightDist > STRAIGHT_FLUSH_DISTANCE && Math.abs(currentTurnSum) > 0) {
            // Min Dist Check
            if (currentTurnDistance > MIN_TURN_DISTANCE) {
              const turnDensity = Math.abs(currentTurnSum) / (currentTurnDistance * 1000 || 1);

              let netHeadingChange = 360;
              if (currentTurnStartBearing !== null) {
                let rawChange = bearing - currentTurnStartBearing;
                if (rawChange > 180) rawChange -= 360;
                if (rawChange < -180) rawChange += 360;
                netHeadingChange = Math.abs(rawChange);
              }

              if (Math.abs(currentTurnSum) > TIGHT_TURN_ANGLE && turnDensity > TURN_DENSITY_THRESHOLD && netHeadingChange > NET_HEADING_CHANGE_MIN) {
                tightTurnsCount++;
                if (Math.abs(currentTurnSum) > HAIRPIN_ANGLE) {
                  hairpinCount++;
                  hairpinPoints.push([currentTurnPeak.lat, currentTurnPeak.lon]);
                } else {
                  tightTurnPoints.push([currentTurnPeak.lat, currentTurnPeak.lon]);
                }
              }
            }
            // Reset Turn State
            currentTurnSum = 0;
            currentTurnStartBearing = null;
            currentTurnDistance = 0;
            currentTurnPeak = { index: -1, delta: 0, lat: 0, lon: 0 };
          }

        } else {
          if (currentStraightDist > MIN_STRAIGHT_SECTION) {
            straightSections.push(currentStraightDist);
            totalStraightDistance += currentStraightDist;
          }
          currentStraightDist = 0;
        }

      } else {
        currentStraightDist = distance;
      }
      lastBearing = bearing;
    } else {
      if (currentStraightDist > 0) currentStraightDist += distance;
    }
  }

  // Flush any pending turn at the end of the loop
  if (currentTurnDistance > MIN_TURN_DISTANCE) {
    const finalTurnDensity = Math.abs(currentTurnSum) / (currentTurnDistance * 1000 || 1);
    // Net heading might be tricky here as we don't have a 'current' bearing to check against readily available or maybe we do (lastBearing)
    // Assuming lastBearing is valid
    let netHeadingChange = 360;
    if (currentTurnStartBearing !== null && lastBearing !== null) {
      let rawChange = lastBearing - currentTurnStartBearing;
      if (rawChange > 180) rawChange -= 360;
      if (rawChange < -180) rawChange += 360;
      netHeadingChange = Math.abs(rawChange);
    }

    if (Math.abs(currentTurnSum) > TIGHT_TURN_ANGLE && finalTurnDensity > TURN_DENSITY_THRESHOLD && netHeadingChange > NET_HEADING_CHANGE_MIN) {
      tightTurnsCount++;
      if (Math.abs(currentTurnSum) > HAIRPIN_ANGLE) {
        hairpinCount++;
        hairpinPoints.push([currentTurnPeak.lat, currentTurnPeak.lon]);
      } else {
        tightTurnPoints.push([currentTurnPeak.lat, currentTurnPeak.lon]);
      }
    }
  }

  // Terrain Classification
  const gradientWindow = GRADIENT_SMOOTHING_WINDOW;
  const smoothedGradients: number[] = [];
  for (let i = 0; i < rawGradients.length; i++) {
    let sum = 0, count = 0;
    const offset = Math.floor(gradientWindow / 2);
    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < rawGradients.length) { sum += rawGradients[idx]; count++; }
    }
    smoothedGradients.push(count > 0 ? sum / count : 0);
  }
  for (let i = 0; i < smoothedGradients.length; i++) {
    const grade = smoothedGradients[i];
    const t = timeDeltas[i];
    const d = robustSegments[i].distance;
    if (grade > CLIMBING_GRADE) { timeClimbing += t; climbDistance += d; }
    else if (grade < DESCENDING_GRADE) { timeDescending += t; }
    else { timeLevel += t; }
  }

  if (currentStraightDist > MIN_STRAIGHT_SECTION) {
    straightSections.push(currentStraightDist);
    totalStraightDistance += currentStraightDist;
  }

  // Motion Profile (Accel)
  const smoothedSpeeds: number[] = [];
  const speedWin = SPEED_SMOOTHING_WINDOW;
  for (let i = 0; i < speeds.length; i++) {
    let sum = 0, count = 0;
    const offset = Math.floor(speedWin / 2);
    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < speeds.length) { sum += speeds[idx]; count++; }
    }
    const avg = count > 0 ? sum / count : 0;
    smoothedSpeeds.push(avg);
    if (avg > maxSpeed && avg < MAX_SPEED_CAP) maxSpeed = avg;
  }

  const rawAccelerations: number[] = [];
  for (let i = 0; i < speeds.length; i++) {
    const t = timeDeltas[i];
    if (i > 0 && t > 0) rawAccelerations.push((speeds[i] / 3.6 - speeds[i - 1] / 3.6) / t);
    else rawAccelerations.push(0);
  }

  const accelWin = ACCEL_SMOOTHING_WINDOW;
  const smoothedAccelerations: number[] = [];
  for (let i = 0; i < rawAccelerations.length; i++) {
    let sum = 0, count = 0;
    const offset = Math.floor(accelWin / 2);
    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < rawAccelerations.length) { sum += rawAccelerations[idx]; count++; }
    }
    smoothedAccelerations.push(count > 0 ? sum / count : 0);
  }

  const { finalAccelerations, hardAccelPoints, hardBrakePoints, hardAccelerationCount, hardBrakingCount } = applyAdvancedFiltering(smoothedAccelerations, timeDeltas, points, isClampedArray);

  // Motion Buckets
  let stoppedTime = 0;
  let stopCount = 0;
  let isStopped = false;
  let stopDur = 0;
  let stopStart = -1;
  const stopPoints: [number, number][] = [];
  let turbulenceSum = 0;
  let timeAccelerating = 0;
  let timeBraking = 0;
  let timeCruising = 0;
  for (let i = 0; i < smoothedSpeeds.length; i++) {
    const s = smoothedSpeeds[i];
    const t = timeDeltas[i];
    const a = finalAccelerations[i];

    if (i > 0) turbulenceSum += Math.abs(a - finalAccelerations[i - 1]);

    if (s < STOP_SPEED_THRESHOLD) {
      stoppedTime += t;
      stopDur += t;
      if (!isStopped) { isStopped = true; stopStart = i; }
    } else {
      if (a > CRUISING_THRESHOLD) timeAccelerating += t;
      else if (a < -CRUISING_THRESHOLD) timeBraking += t;
      else timeCruising += t;

      if (isStopped) {
        if (stopDur >= 10) {
          stopCount++;
          if (stopStart >= 0) stopPoints.push([points[stopStart].lat, points[stopStart].lon]);
        }
        stopDur = 0; isStopped = false; stopStart = -1;
      }
    }
  }
  if (isStopped && stopDur >= 10) {
    stopCount++;
    if (stopStart >= 0) stopPoints.push([points[stopStart].lat, points[stopStart].lon]);
  }

  let totalTime = 0;
  if (points[0].time && points[points.length - 1].time) totalTime = (points[points.length - 1].time!.getTime() - points[0].time!.getTime()) / 1000;

  const twistinessScore = totalDistance > 0 ? totalHeadingChange / totalDistance : 0;
  const percentStraight = totalDistance > 0 ? (totalStraightDistance / totalDistance) * 100 : 0;
  const longestStraightSection = straightSections.length > 0 ? Math.max(...straightSections) : 0;
  const medianStraightLength = straightSections.length > 0 ? straightSections.sort((a, b) => a - b)[Math.floor(straightSections.length / 2)] : 0;

  return {
    totalDistance, totalTime, movingTime: Math.max(0, totalTime - stoppedTime), stoppedTime, stopCount,
    avgSpeed: totalTime > 0 ? totalDistance / (totalTime / 3600) : 0,
    movingAvgSpeed: (totalTime - stoppedTime) > 0 ? totalDistance / ((totalTime - stoppedTime) / 3600) : 0,
    maxSpeed, elevationGain, pointCount: points.length,
    stopPoints, hardAccelerationCount, hardBrakingCount,
    timeAccelerating, timeBraking, timeCruising,
    accelBrakeRatio: timeBraking > 0 ? timeAccelerating / timeBraking : timeAccelerating,
    turbulenceScore: smoothedSpeeds.length > 0 ? (turbulenceSum / smoothedSpeeds.length) * 10 : 0,
    startTime: points[0]?.time,
    elevationLoss, maxElevation, minElevation, steepestClimb, steepestDescent,
    timeClimbing, timeDescending, timeLevel,
    hillinessScore: totalDistance > 0 ? elevationGain / totalDistance : 0,
    climbDistance,
    totalHeadingChange, tightTurnsCount, hairpinCount, twistinessScore,
    longestStraightSection, medianStraightLength, percentStraight,
    tightTurnPoints, hairpinPoints, hardAccelPoints, hardBrakePoints,
    speedDistribution: calculateSpeedDistribution(points)
  };
}


export interface TrackSegment {
  speed: number;        // km/h
  acceleration: number; // m/s^2
}

export function analyzeSegments(points: GPXPoint[]): TrackSegment[] {
  if (points.length < 2) return [];

  const segments: TrackSegment[] = [];
  const robustSegments = calculateRobustSpeeds(points);
  const speeds = robustSegments.map(s => s.speed);
  const timeDeltas = robustSegments.map(s => s.time);
  const isClampedArray = robustSegments.map(s => s.isClamped);

  // 1. Smooth Speeds (Moving Average)
  const smoothedSpeeds: number[] = [];
  const WINDOW_SIZE = SPEED_SMOOTHING_WINDOW;

  for (let i = 0; i < speeds.length; i++) {
    let sum = 0;
    let count = 0;
    const offset = Math.floor(WINDOW_SIZE / 2);

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < speeds.length) {
        sum += speeds[idx];
        count++;
      }
    }
    smoothedSpeeds.push(count > 0 ? sum / count : 0);
  }

  // 2. Calculate Raw Accelerations (From Smoothed Speeds)
  // This ensures the acceleration map matches the visual timeline chart (which is smoothed)
  const rawAccelerations: number[] = [];
  for (let i = 0; i < smoothedSpeeds.length; i++) {
    const time = timeDeltas[i];
    if (i > 0 && time > 0) {
      const v1 = smoothedSpeeds[i - 1] / 3.6; // m/s (Smoothed)
      const v2 = smoothedSpeeds[i] / 3.6;   // m/s (Smoothed)
      rawAccelerations.push((v2 - v1) / time);
    } else {
      rawAccelerations.push(0);
    }
  }

  // 3. Smooth Accelerations (Light Moving Average)
  const ACCEL_WINDOW = ACCEL_SMOOTHING_WINDOW;
  const smoothedAccelerations: number[] = [];

  for (let i = 0; i < rawAccelerations.length; i++) {
    let sum = 0;
    let count = 0;
    const offset = Math.floor(ACCEL_WINDOW / 2);

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < rawAccelerations.length) {
        sum += rawAccelerations[idx];
        count++;
      }
    }
    smoothedAccelerations.push(count > 0 ? sum / count : 0);
  }

  // GAP & ADVANCED FILTERING
  const { finalAccelerations } = applyAdvancedFiltering(smoothedAccelerations, timeDeltas, points, isClampedArray);

  // 4. Build Segments with Smoothed Data (Acceleration) but Raw/Robust Speed
  for (let i = 0; i < smoothedSpeeds.length; i++) {
    const accel = finalAccelerations[i]; // Use filtered acceleration

    segments.push({
      speed: speeds[i], // Use Robust Speed (not smoothed) as requested
      acceleration: accel
    });
  }

  return segments;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

// Mobile-friendly version that omits seconds
export function formatDurationShort(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export const formatDistance = (km: number): string => {
  return `${km.toFixed(1)} km`;
};

export const formatSpeed = (kmh: number): string => {
  return `${kmh.toFixed(1)} km/h`;
};

// Helper to downsample track for mini-maps (preserve shape with fewer points)
export function generatePreviewPolyline(points: GPXPoint[], targetCount: number = 100): [number, number][] {
  if (points.length <= targetCount) {
    return points.map(p => [p.lat, p.lon]);
  }

  const step = points.length / targetCount;
  const sampled: [number, number][] = [];

  for (let i = 0; i < targetCount; i++) {
    const index = Math.min(Math.floor(i * step), points.length - 1);
    sampled.push([points[index].lat, points[index].lon]);
  }

  // Always include the last point
  const last = points[points.length - 1];
  sampled.push([last.lat, last.lon]);

  return sampled;
}

/**
 * Calculate what-if stats if speed was capped at a given limit.
 * Returns: original time, simulated time, time added, new avg speed, % slower
 */
export interface LimitedStatsResult {
  originalTime: number;    // seconds
  simulatedTime: number;   // seconds
  timeAdded: number;       // seconds
  originalAvgSpeed: number; // km/h
  newAvgSpeed: number;     // km/h
  percentSlower: number;   // percentage
  cappedSegments: number;  // count of segments that were capped
  totalSegments: number;   // total segments
}

export function calculateLimitedStats(points: GPXPoint[], speedLimitKmh: number): LimitedStatsResult | null {
  if (points.length < 2 || speedLimitKmh <= 0) return null;

  let totalDistance = 0;    // km
  let originalTime = 0;     // seconds
  let simulatedTime = 0;    // seconds
  let cappedSegments = 0;
  let totalSegments = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon); // km
    totalDistance += dist;

    if (prev.time && curr.time) {
      const segmentTimeSeconds = (curr.time.getTime() - prev.time.getTime()) / 1000;

      if (segmentTimeSeconds > 0) {
        originalTime += segmentTimeSeconds;
        totalSegments++;

        const segmentSpeedKmh = dist / (segmentTimeSeconds / 3600);

        if (segmentSpeedKmh > speedLimitKmh && segmentSpeedKmh < MAX_SPEED_CAP) { // Sanity cap
          // Time if we traveled at speed limit instead
          const newTimeSeconds = (dist / speedLimitKmh) * 3600;
          simulatedTime += newTimeSeconds;
          cappedSegments++;
        } else {
          simulatedTime += segmentTimeSeconds;
        }
      }
    }
  }

  if (originalTime === 0 || totalDistance === 0) return null;

  const originalAvgSpeed = totalDistance / (originalTime / 3600);
  const newAvgSpeed = totalDistance / (simulatedTime / 3600);
  const timeAdded = simulatedTime - originalTime;
  const percentSlower = originalAvgSpeed > 0 ? ((originalAvgSpeed - newAvgSpeed) / originalAvgSpeed) * 100 : 0;

  return {
    originalTime,
    simulatedTime,
    timeAdded,
    originalAvgSpeed,
    newAvgSpeed,
    percentSlower,
    cappedSegments,
    totalSegments
  };
}

/**
 * Calculates robust speeds by clamping physically impossible acceleration.
 * This filters out GPS jitter spikes.
 */
function calculateRobustSpeeds(points: GPXPoint[]): { speed: number; time: number; distance: number; isClamped: boolean }[] {
  if (points.length < 2) return [];

  const results: { speed: number; time: number; distance: number; isClamped: boolean }[] = [];
  // Dynamic Acceleration Limit
  // 9.0 m/s^2 at 0 km/h (launch)
  // Decays by 1 m/s^2 every 25 km/h
  // Min 2.0 m/s^2 at high speeds (>175 km/h)
  const getMaxAccel = (speedKmh: number) => {
    return Math.max(2.0, 9.0 - (speedKmh / 25.0));
  };

  let prevSpeedMps = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const distKm = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    let timeSec = 0;

    if (prev.time && curr.time) {
      timeSec = (curr.time.getTime() - prev.time.getTime()) / 1000;
    }

    let speedKmh = 0;
    let speedMps = 0;
    let isClamped = false;

    if (timeSec > 0) {
      const rawSpeedKmh = distKm / (timeSec / 3600);
      const rawSpeedMps = rawSpeedKmh / 3.6;

      // Check Accel against Dynamic Limit based on CURRENT Speed (or prev speed)
      // Using Prev Speed is safer for causality
      const prevSpeedKmh = prevSpeedMps * 3.6;
      const maxAccel = getMaxAccel(prevSpeedKmh);

      const accel = (rawSpeedMps - prevSpeedMps) / timeSec;

      if (accel > maxAccel) {
        // Clamp speed to max possible acceleration
        speedMps = prevSpeedMps + (maxAccel * timeSec);
        speedKmh = speedMps * 3.6;
        isClamped = true;
      } else {
        speedKmh = rawSpeedKmh;
        speedMps = rawSpeedMps;
      }

      // Hard sanity check (e.g. 350km/h)
      if (speedKmh > 350) {
        speedKmh = prevSpeedMps * 3.6; // Reuse prev speed if nonsense
        isClamped = true;
      }
    }

    results.push({ speed: speedKmh, time: timeSec, distance: distKm, isClamped });
    prevSpeedMps = speedKmh / 3.6;
  }

  return results;
}

