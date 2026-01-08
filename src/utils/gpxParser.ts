export interface GPXPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: Date;
}

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
  hardAccelPoints?: [number, number, number][]; // [lat, lon, m/s²]
  hardBrakePoints?: [number, number, number][]; // [lat, lon, m/s²]
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

export interface SpeedBucket {
  range: string;
  minSpeed: number;
  time: number; // minutes
  distance: number; // km
}

export function calculateSpeedDistribution(points: GPXPoint[], bucketSize: number = 10): SpeedBucket[] {
  if (points.length < 2) return [];

  const robustSegments = calculateRobustSpeeds(points);
  const speeds = robustSegments.map(s => s.speed);

  // 2. Smooth Speeds (Moving Average)
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

  // 3. Bucketize
  const buckets: Record<number, { time: number; distance: number }> = {};
  let maxBucketIndex = 0;

  robustSegments.forEach((seg, i) => {
    const speed = smoothedSpeeds[i];
    if (speed < 0.1) return; // Ignore stops

    const bucketIndex = Math.floor(speed / bucketSize) * bucketSize;
    if (!buckets[bucketIndex]) {
      buckets[bucketIndex] = { time: 0, distance: 0 };
    }
    // seg.time is seconds. Convert to minutes.
    buckets[bucketIndex].time += seg.time / 60;
    buckets[bucketIndex].distance += seg.distance;

    if (bucketIndex > maxBucketIndex) maxBucketIndex = bucketIndex;
  });

  // 4. Format Output with Tail Truncation (Remove high speed noise < 20s)
  const result: SpeedBucket[] = [];
  let foundValidTop = false;

  // Iterate backwards from max bucket to 0
  for (let i = maxBucketIndex; i >= 0; i -= bucketSize) {
    const data = buckets[i] || { time: 0, distance: 0 };

    // Time in minutes. 20 seconds = 0.333 minutes.
    const durationSeconds = data.time * 60;

    // Logic: If we haven't found a valid top yet, check if this bucket is significant (>20s).
    // If it is NOT significant, skip it (it's noise).
    // Once we find a significant bucket, 'foundValidTop' becomes true, and we accept all lower buckets.
    if (!foundValidTop) {
      if (durationSeconds >= 20) {
        foundValidTop = true;
      } else {
        // Skip this bucket as it's likely high-speed GPS noise
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

  // Try to get trackpoints first (most common)
  let trackpoints = xmlDoc.getElementsByTagName("trkpt");

  // If no trackpoints, try waypoints
  if (trackpoints.length === 0) {
    trackpoints = xmlDoc.getElementsByTagName("wpt");
  }

  // If still no points, try route points
  if (trackpoints.length === 0) {
    trackpoints = xmlDoc.getElementsByTagName("rtept");
  }

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
  const speeds: number[] = [];
  const timeDeltas: number[] = []; // seconds

  // Handle first point elevation
  if (points[0].ele !== undefined) {
    maxElevation = points[0].ele;
    minElevation = points[0].ele;
  }

  // Pre-calculate robust speeds to filter GPS noise
  const robustSegments = calculateRobustSpeeds(points);

  // Smooth elevation data to prevent noise inflation
  const ELEVATION_WINDOW_SIZE = 5;
  const smoothedElevations: (number | undefined)[] = [];

  for (let i = 0; i < points.length; i++) {
    if (points[i].ele === undefined) {
      smoothedElevations.push(undefined);
      continue;
    }

    let sum = 0;
    let count = 0;
    const offset = Math.floor(ELEVATION_WINDOW_SIZE / 2);

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < points.length && points[idx].ele !== undefined) {
        sum += points[idx].ele!;
        count++;
      }
    }

    smoothedElevations.push(count > 0 ? sum / count : points[i].ele);
  }

  // First pass: Calculate basic metrics using robust data
  const rawGradients: number[] = [];

  for (let i = 0; i < robustSegments.length; i++) {
    const { speed, time: timeDiff, distance } = robustSegments[i];
    // Map back to original points logic. robustSegments[i] corresponds to segment between points[i] and points[i+1]

    // We need i+1 to match points index
    const prev = points[i];
    const curr = points[i + 1];

    totalDistance += distance;
    speeds.push(speed);
    timeDeltas.push(timeDiff);

    const prevEle = smoothedElevations[i];
    const currEle = smoothedElevations[i + 1];

    if (prevEle !== undefined && currEle !== undefined) {
      const eleDiff = currEle - prevEle;

      // Smoothed elevation ensures noise filtering without breaking net change relationship
      if (eleDiff > 0) {
        elevationGain += eleDiff;
      } else if (eleDiff < 0) {
        elevationLoss += Math.abs(eleDiff);
      }

      // Calculate raw gradient for this segment
      if (distance > 0.001) {
        const gradientPercent = (eleDiff / (distance * 1000)) * 100;
        rawGradients.push(gradientPercent);
      } else {
        rawGradients.push(0);
      }

      // Max/Min (use smoothed elevation)
      if (currEle > maxElevation) maxElevation = currEle;
      if (currEle < minElevation) minElevation = currEle;

      // Steepest sections (only for segments > 5m to filter GPS jitters)
      if (distance > 0.005 && Math.abs(eleDiff) > 0.5) {
        const gradient = (eleDiff / (distance * 1000)) * 100;
        if (gradient > steepestClimb) steepestClimb = gradient;
        if (gradient < steepestDescent) steepestDescent = gradient;
      }
    } else {
      rawGradients.push(0);
    }

    // Geometry Calculations
    if (distance > 0.002) { // Only calculate bearing if moved more than 2m
      const bearing = calculateBearing(prev.lat, prev.lon, curr.lat, curr.lon);
      if (lastBearing !== null) {
        let delta = Math.abs(bearing - lastBearing);
        if (delta > 180) delta = 360 - delta;

        totalHeadingChange += delta;
        if (delta > 45) {
          tightTurnsCount++;
          tightTurnPoints.push([curr.lat, curr.lon]);
        }
        if (delta > 135) hairpinCount++;

        // Straight section logic (threshold 5 degrees)
        if (delta < 5) {
          currentStraightDist += distance;
        } else {
          if (currentStraightDist > 0.02) { // Min 20m
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
      // If stopped or jittering, don't update bearing but accumulate distance if moving slowly
      if (currentStraightDist > 0) currentStraightDist += distance;
    }
  }

  // Smooth gradients to prevent oscillation in terrain classification
  const GRADIENT_WINDOW_SIZE = 5;
  const smoothedGradients: number[] = [];

  for (let i = 0; i < rawGradients.length; i++) {
    let sum = 0;
    let count = 0;
    const offset = Math.floor(GRADIENT_WINDOW_SIZE / 2);

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < rawGradients.length) {
        sum += rawGradients[idx];
        count++;
      }
    }
    smoothedGradients.push(count > 0 ? sum / count : 0);
  }

  // Second pass: Classify terrain time using smoothed gradients
  for (let i = 0; i < smoothedGradients.length; i++) {
    const gradientPercent = smoothedGradients[i];
    const timeDiff = timeDeltas[i];
    const distance = robustSegments[i].distance;

    // Thresholds: ±1% gradient to be considered climbing/descending
    if (gradientPercent > 1.0) {
      timeClimbing += timeDiff;
      climbDistance += distance;
    } else if (gradientPercent < -1.0) {
      timeDescending += timeDiff;
    } else {
      timeLevel += timeDiff;
    }
  }

  if (currentStraightDist > 0.02) {
    straightSections.push(currentStraightDist);
    totalStraightDistance += currentStraightDist;
  }

  // Summary Geometry Stats
  const twistinessScore = totalDistance > 0 ? totalHeadingChange / totalDistance : 0;
  const longestStraightSection = straightSections.length > 0 ? Math.max(...straightSections) : 0;
  const sortedStraights = [...straightSections].sort((a, b) => a - b);
  const medianStraightLength = sortedStraights.length > 0
    ? sortedStraights[Math.floor(sortedStraights.length / 2)]
    : 0;
  const percentStraight = totalDistance > 0 ? (totalStraightDistance / totalDistance) * 100 : 0;

  // Fallback for no elevation data
  if (maxElevation === -Infinity) {
    maxElevation = 0;
    minElevation = 0;
  }

  // Apply Smoothing (Moving Average)
  const WINDOW_SIZE = 5;
  const smoothedSpeeds: number[] = [];
  for (let i = 0; i < speeds.length; i++) {
    let sum = 0, count = 0;
    const offset = Math.floor(WINDOW_SIZE / 2);
    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < speeds.length) {
        sum += speeds[idx];
        count++;
      }
    }
    const avg = count > 0 ? sum / count : 0;
    smoothedSpeeds.push(avg);
    if (avg > maxSpeed && avg < 200) maxSpeed = avg;
  }

  // --- NEW: Smoothed Acceleration Calculation for Robust Motion Stats ---

  // 1. Calculate Raw Accelerations (From Robust Speeds for consistency)
  const rawAccelerations: number[] = [];
  for (let i = 0; i < speeds.length; i++) {
    const time = timeDeltas[i];
    if (i > 0 && time > 0) {
      // (v2 - v1) / t, convert km/h to m/s
      // Using speeds[i] (Robust) instead of smoothedSpeeds to match map responsiveness
      const accel = (speeds[i] / 3.6 - speeds[i - 1] / 3.6) / time;
      rawAccelerations.push(accel);
    } else {
      rawAccelerations.push(0);
    }
  }

  // 2. Smooth Accelerations (Moving Average)
  // Reduced to 3 for sharper stats
  const ACCEL_WINDOW_SIZE = 3;
  const smoothedAccelerations: number[] = [];
  for (let i = 0; i < rawAccelerations.length; i++) {
    let sum = 0, count = 0;
    const offset = Math.floor(ACCEL_WINDOW_SIZE / 2);
    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < rawAccelerations.length) {
        sum += rawAccelerations[idx];
        count++;
      }
    }
    smoothedAccelerations.push(count > 0 ? sum / count : 0);
  }

  // Calculate Motion Stats
  let hardAccelerationCount = 0;
  let hardBrakingCount = 0;
  let timeAccelerating = 0;
  let timeBraking = 0;
  let timeCruising = 0;
  let stoppedTime = 0;
  let stopCount = 0;
  let turbulenceSum = 0;

  const STOP_THRESHOLD = 5.0; // km/h
  const ACCEL_THRESHOLD = 0.2; // m/s^2 for "accelerating"
  const HARD_ACCEL_LIMIT = 2.5;
  const HARD_BRAKE_LIMIT = -3.0;

  let isCurrentlyStoppedSegment = false;
  let potentialStopDuration = 0;
  let potentialStopStartIndex = -1;
  const stopPoints: [number, number][] = [];

  // State for event-based counting
  let inHardAccelEvent = false;
  let inHardBrakeEvent = false;
  const hardAccelPoints: [number, number, number][] = [];
  const hardBrakePoints: [number, number, number][] = [];

  for (let i = 0; i < smoothedSpeeds.length; i++) {
    const speed = smoothedSpeeds[i];
    const time = timeDeltas[i];
    const smoothedAccel = smoothedAccelerations[i];
    const rawAccel = rawAccelerations[i];

    // Turbulence: Change in acceleration
    if (i > 0) {
      const prevAccel = smoothedAccelerations[i - 1];
      turbulenceSum += Math.abs(smoothedAccel - prevAccel);
    }

    // --- Hard Point Event Detection (Uses Smoothed Acceleration) ---
    if (smoothedAccel > HARD_ACCEL_LIMIT) {
      if (!inHardAccelEvent) {
        hardAccelerationCount++;
        inHardAccelEvent = true;
        // Record the point with its acceleration value
        const point = points[i + 1]; // i+1 because segments are between points
        if (point) {
          hardAccelPoints.push([point.lat, point.lon, smoothedAccel]);
        }
      }
    } else {
      inHardAccelEvent = false;
    }

    if (smoothedAccel < HARD_BRAKE_LIMIT) {
      if (!inHardBrakeEvent) {
        hardBrakingCount++;
        inHardBrakeEvent = true;
        // Record the point with its acceleration value
        const point = points[i + 1]; // i+1 because segments are between points
        if (point) {
          hardBrakePoints.push([point.lat, point.lon, Math.abs(smoothedAccel)]);
        }
      }
    } else {
      inHardBrakeEvent = false;
    }

    // --- Motion Profile Time Bucketing (Uses Raw Acceleration) ---
    if (speed < STOP_THRESHOLD) {
      stoppedTime += time;
      potentialStopDuration += time;
      if (!isCurrentlyStoppedSegment) {
        isCurrentlyStoppedSegment = true;
        potentialStopStartIndex = i;
      }
    } else {
      // Use raw acceleration for motion profile
      if (rawAccel > ACCEL_THRESHOLD) timeAccelerating += time;
      else if (rawAccel < -ACCEL_THRESHOLD) timeBraking += time;
      else timeCruising += time;

      if (isCurrentlyStoppedSegment) {
        if (potentialStopDuration >= 10) {
          stopCount++;
          if (potentialStopStartIndex >= 0 && potentialStopStartIndex < points.length) {
            const p = points[potentialStopStartIndex];
            stopPoints.push([p.lat, p.lon]);
          }
        }
        potentialStopDuration = 0;
        isCurrentlyStoppedSegment = false;
        potentialStopStartIndex = -1;
      }
    }
  }

  if (isCurrentlyStoppedSegment && potentialStopDuration >= 10) {
    stopCount++;
    if (potentialStopStartIndex >= 0 && potentialStopStartIndex < points.length) {
      const p = points[potentialStopStartIndex];
      stopPoints.push([p.lat, p.lon]);
    }
  }

  let totalTime = 0;
  if (points[0].time && points[points.length - 1].time) {
    totalTime = (points[points.length - 1].time.getTime() - points[0].time.getTime()) / 1000;
  }
  const movingTime = Math.max(0, totalTime - stoppedTime);
  const avgSpeed = totalTime > 0 ? totalDistance / (totalTime / 3600) : 0;
  const movingAvgSpeed = movingTime > 0 ? totalDistance / (movingTime / 3600) : 0;
  const accelBrakeRatio = timeBraking > 0 ? timeAccelerating / timeBraking : timeAccelerating;
  const turbulenceScore = smoothedSpeeds.length > 0 ? (turbulenceSum / smoothedSpeeds.length) * 10 : 0;

  // Hilliness Score: Elevation gain per kilometer
  const hillinessScore = totalDistance > 0 ? elevationGain / totalDistance : 0;

  return {
    totalDistance,
    totalTime,
    movingTime,
    stoppedTime,
    stopCount,
    avgSpeed,
    movingAvgSpeed,
    maxSpeed,
    elevationGain,
    pointCount: points.length,
    stopPoints,
    hardAccelerationCount,
    hardBrakingCount,
    timeAccelerating,
    timeBraking,
    timeCruising,
    accelBrakeRatio,
    turbulenceScore,
    startTime: points[0]?.time,
    elevationLoss,
    maxElevation,
    minElevation,
    steepestClimb,
    steepestDescent,
    timeClimbing,
    timeDescending,
    timeLevel,
    hillinessScore,
    climbDistance,
    totalHeadingChange,
    tightTurnsCount,
    hairpinCount,
    twistinessScore,
    longestStraightSection,
    medianStraightLength,
    percentStraight,
    tightTurnPoints,
    hardAccelPoints,
    hardBrakePoints,
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

  // 1. Smooth Speeds (Moving Average)
  const smoothedSpeeds: number[] = [];
  const WINDOW_SIZE = 5;

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

  // 2. Calculate Raw Accelerations (From Robust Speeds, not Smoothed)
  // This ensures the acceleration map matches the sharp speed changes
  const rawAccelerations: number[] = [];
  for (let i = 0; i < speeds.length; i++) {
    const time = timeDeltas[i];
    if (i > 0 && time > 0) {
      const v1 = speeds[i - 1] / 3.6; // m/s (Robust)
      const v2 = speeds[i] / 3.6;   // m/s (Robust)
      rawAccelerations.push((v2 - v1) / time);
    } else {
      rawAccelerations.push(0);
    }
  }

  // 3. Smooth Accelerations (Light Moving Average)
  // Reduced from 5 to 3 to be more reactive but still filter differentiation noise
  const ACCEL_WINDOW_SIZE = 3;
  const smoothedAccelerations: number[] = [];

  for (let i = 0; i < rawAccelerations.length; i++) {
    let sum = 0;
    let count = 0;
    const offset = Math.floor(ACCEL_WINDOW_SIZE / 2);

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < rawAccelerations.length) {
        sum += rawAccelerations[idx];
        count++;
      }
    }
    smoothedAccelerations.push(count > 0 ? sum / count : 0);
  }

  // 4. Build Segments with Smoothed Data (Acceleration) but Raw/Robust Speed
  for (let i = 0; i < smoothedSpeeds.length; i++) {
    segments.push({
      speed: speeds[i], // Use Robust Speed (not smoothed) as requested
      acceleration: smoothedAccelerations[i]
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

export function formatDistance(km: number): string {
  if (km < 1) {
    return `${(km * 1000).toFixed(0)} m`;
  }
  return `${km.toFixed(2)} km`;
}

export function formatSpeed(kmh: number): string {
  return `${kmh.toFixed(1)} km/h`;
}

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

        if (segmentSpeedKmh > speedLimitKmh && segmentSpeedKmh < 200) { // 200 is sanity cap
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
function calculateRobustSpeeds(points: GPXPoint[]): { speed: number; time: number; distance: number }[] {
  if (points.length < 2) return [];

  const results: { speed: number; time: number; distance: number }[] = [];
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
      } else {
        speedKmh = rawSpeedKmh;
        speedMps = rawSpeedMps;
      }

      // Hard sanity check (e.g. 350km/h)
      if (speedKmh > 350) speedKmh = prevSpeedMps * 3.6; // Reuse prev speed if nonsense
    }

    results.push({ speed: speedKmh, time: timeSec, distance: distKm });
    prevSpeedMps = speedKmh / 3.6;
  }

  return results;
}

