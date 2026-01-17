import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { GPXPoint } from "@/utils/gpxParser";
import { useState } from "react";

interface SpeedElevationChartProps {
  points: GPXPoint[];
  onHover?: (point: GPXPoint | null) => void;
  onZoomChange: (range: [number, number] | null) => void;
  zoomRange: [number, number] | null;
  speedLimit?: number | null;
  speedCap?: number | null;
  visualLimit?: number;
}

interface ChartDataPoint {
  distance: number;
  speed: number;
  elevation: number | null;
  time: string;
  pointIndex: number;
}

// Haversine formula
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
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

const SpeedElevationChart = ({
  points,
  onHover,
  onZoomChange,
  zoomRange,
  speedLimit,
  speedCap,
  visualLimit
}: SpeedElevationChartProps) => {
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<'speed' | 'elevation' | null>(null);

  // Calculate combined data for chart
  const fullData: ChartDataPoint[] = [];
  let cumulativeDistance = 0;

  // First pass: Calculate all raw speeds and distances
  const rawData: { dist: number; speed: number; ele: number | null; time: Date | undefined }[] = [];

  // Dynamic Acceleration Limit - Matching gpxParser logic
  const getMaxAccel = (speedKmh: number) => {
    return Math.max(2.0, 9.0 - (speedKmh / 25.0));
  };

  let prevSpeedMps = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const distance = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    cumulativeDistance += distance;

    let speedKmh = 0;
    let speedMps = 0;

    if (prev.time && curr.time) {
      const timeDiff = (curr.time.getTime() - prev.time.getTime()) / 1000;
      if (timeDiff > 0) {
        const rawSpeedKmh = distance / (timeDiff / 3600);
        const rawSpeedMps = rawSpeedKmh / 3.6;

        // Check Accel against Dynamic Limit
        const prevSpeedKmh = prevSpeedMps * 3.6;
        const maxAccel = getMaxAccel(prevSpeedKmh);

        const accel = (rawSpeedMps - prevSpeedMps) / timeDiff;

        if (accel > maxAccel) {
          // Clamp
          speedMps = prevSpeedMps + (maxAccel * timeDiff);
          speedKmh = speedMps * 3.6;
        } else {
          speedKmh = rawSpeedKmh;
          speedMps = rawSpeedMps;
        }

        // Outlier rejection (hard 350 cap)
        if (speedKmh > 350) speedKmh = prevSpeedMps * 3.6;
      }
    }

    // Update State
    prevSpeedMps = speedMps;

    rawData.push({
      dist: parseFloat(cumulativeDistance.toFixed(2)),
      speed: speedKmh,
      ele: curr.ele !== undefined ? curr.ele : null,
      time: curr.time
    });
  }

  // Calculate True Max Speed (for Scale) BEFORE any visual clipping
  const trueMaxSpeed = Math.max(...rawData.map(d => d.speed), 0);

  // Second pass: Apply smoothing
  const WINDOW_SIZE = 5;
  const offset = Math.floor(WINDOW_SIZE / 2);

  for (let i = 0; i < rawData.length; i++) {
    // 1. Calculate Smoothed Speed
    let sum = 0;
    let count = 0;

    for (let j = -offset; j <= offset; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < rawData.length) {
        sum += rawData[idx].speed;
        count++;
      }
    }
    const smoothedSpeed = count > 0 ? sum / count : 0;
    const currRaw = rawData[i];

    let finalSpeed = parseFloat(smoothedSpeed.toFixed(1));
    // speedCap is the HARD limit (e.g. 50km/h set by owner).
    if (speedCap && finalSpeed > speedCap) finalSpeed = speedCap;

    // visualLimit is the SOFT limit (e.g. simulation).
    if (visualLimit && finalSpeed > visualLimit) finalSpeed = visualLimit;

    fullData.push({
      distance: rawData[i].dist,
      speed: finalSpeed,
      elevation: rawData[i].ele,
      time: rawData[i].time ? rawData[i].time!.toLocaleTimeString() : '',
      pointIndex: i + 1,
    });
  }

  if (fullData.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
        No data available to display chart
      </div>
    );
  }

  const hasElevation = fullData.some((d) => d.elevation !== null);

  // Prepare Speed Chart Data (filtered by zoom)
  const speedChartData = zoomRange
    ? fullData.filter(d => d.pointIndex >= zoomRange[0] && d.pointIndex <= zoomRange[1])
    : fullData;

  // Sample speed data for performance (target ~300 points)
  const sampleSpeedData = (data: ChartDataPoint[]) => {
    const targetPoints = 300;
    const sampleRate = Math.max(1, Math.floor(data.length / targetPoints));
    return data.filter((_, idx) => idx % sampleRate === 0 || idx === data.length - 1);
  };

  const sampledSpeedData = sampleSpeedData(speedChartData);

  // Prepare Elevation Chart Data (always full route)
  const sampleElevationData = (data: ChartDataPoint[]) => {
    const targetPoints = 200; // Even more aggressive sampling for elevation
    const sampleRate = Math.max(1, Math.floor(data.length / targetPoints));
    return data.filter((_, idx) => idx % sampleRate === 0 || idx === data.length - 1);
  };

  const sampledElevationData = hasElevation ? sampleElevationData(fullData) : [];

  // Calculate elevation range for better scaling
  const elevations = fullData.map((d) => d.elevation).filter((e): e is number => e !== null);
  const minElevation = elevations.length > 0 ? Math.min(...elevations) : 0;
  const maxElevation = elevations.length > 0 ? Math.max(...elevations) : 1000;
  const elevationRange = maxElevation - minElevation || 100;

  // Calculate distance domain (always full route)
  const minDistance = fullData[0]?.distance || 0;
  const maxDistance = fullData[fullData.length - 1]?.distance || 100;

  const zoom = () => {
    if (refAreaLeft === refAreaRight || refAreaRight === null || refAreaLeft === null) {
      // Click (Reset zoom)
      if (zoomRange) {
        onZoomChange(null);
      }
      setRefAreaLeft(null);
      setRefAreaRight(null);
      setActiveChart(null);
      return;
    }

    // Identify start/end distances
    let leftDist = parseFloat(refAreaLeft);
    let rightDist = parseFloat(refAreaRight);

    if (leftDist > rightDist) [leftDist, rightDist] = [rightDist, leftDist];

    const startData = fullData.find(p => p.distance >= leftDist);
    const endData = fullData.find(p => p.distance >= rightDist);

    if (startData && endData) {
      let startIndex = startData.pointIndex;
      let endIndex = endData.pointIndex;

      // Ensure we always have at least 5 points for context
      const MIN_POINTS = 5;
      const diff = endIndex - startIndex;

      if (diff < MIN_POINTS) {
        const padding = Math.ceil((MIN_POINTS - diff) / 2);
        startIndex = Math.max(0, startIndex - padding);
        endIndex = Math.min(points.length - 1, endIndex + padding);

        if (endIndex - startIndex < MIN_POINTS) {
          if (startIndex === 0) endIndex = Math.min(points.length - 1, startIndex + MIN_POINTS);
          if (endIndex === points.length - 1) startIndex = Math.max(0, endIndex - MIN_POINTS);
        }
      }

      if (startIndex !== endIndex) {
        onZoomChange([startIndex, endIndex]);
      }
    }

    setRefAreaLeft(null);
    setRefAreaRight(null);
    setActiveChart(null);
  };

  const handleMouseMove = (e: any, chartType: 'speed' | 'elevation') => {
    if (refAreaLeft && activeChart === chartType) {
      // dragging
      if (e.activeLabel) {
        setRefAreaRight(e.activeLabel);
      }
    }

    if (!e || !e.activePayload || !e.activePayload[0] || !onHover) {
      return;
    }

    const activeData = e.activePayload[0].payload as ChartDataPoint;
    const pointIndex = activeData.pointIndex;

    if (pointIndex !== undefined && pointIndex < points.length) {
      onHover(points[pointIndex]);
    }
  };

  const handleMouseDown = (e: any, chartType: 'speed' | 'elevation') => {
    if (e && e.activeLabel) {
      setRefAreaLeft(e.activeLabel);
      setRefAreaRight(null);
      setActiveChart(chartType);
    }
  };

  const handleMouseUp = () => {
    zoom();
  };

  const handleMouseLeave = () => {
    if (onHover) onHover(null);
    setRefAreaLeft(null);
    setRefAreaRight(null);
    setActiveChart(null);
  };

  // Shared margin configuration to ensure perfect horizontal alignment
  const chartMargin = { top: 10, right: 30, left: 0, bottom: 0 };

  return (
    <div className="h-full w-full rounded-2xl border border-border bg-card p-6 select-none flex flex-col">
      {/* Speed Chart (Main - 70% height) */}
      <div className="flex-[7] w-full min-h-0 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={sampledSpeedData}
            margin={chartMargin}
            onMouseMove={(e) => handleMouseMove(e, 'speed')}
            onMouseLeave={handleMouseLeave}
            onMouseDown={(e) => handleMouseDown(e, 'speed')}
            onMouseUp={handleMouseUp}
          >
            <defs>
              <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.6} />
                <stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(23, 5%, 82%)" opacity={0.5} />
            <XAxis
              dataKey="distance"
              type="number"
              domain={[minDistance, maxDistance]}
              stroke="#9ca3af"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickCount={8}
              tickFormatter={(value) => `${Math.round(value)} km`}
              allowDataOverflow
            />
            <YAxis
              stroke="hsl(15, 52%, 58%)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => Math.round(value).toString()}
              label={{ value: "Speed (km/h)", angle: -90, position: "insideLeft", fontSize: 12, fill: "hsl(15, 52%, 58%)" }}
              width={60}
              domain={[0, speedCap ? speedCap : Math.ceil(trueMaxSpeed / 10) * 10]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(60, 9%, 94%)",
                border: "1px solid hsl(60, 5%, 85%)",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              formatter={(value: number) => [`${value} km/h`, "Speed"]}
              labelFormatter={(label) => `Distance: ${label} km`}
            />
            <Area
              type="monotone"
              dataKey="speed"
              stroke="hsl(15, 52%, 58%)"
              strokeWidth={3}
              fill="url(#speedGradient)"
              isAnimationActive={false}
            />

            {activeChart === 'speed' && refAreaLeft && refAreaRight && (
              <ReferenceArea
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="hsl(15, 52%, 58%)"
                fillOpacity={0.3}
              />
            )}

            {speedLimit && (
              <ReferenceLine
                y={speedLimit}
                stroke="hsl(5, 53%, 51%)"
                strokeWidth={3}
                strokeOpacity={0.8}
                label={{
                  value: `Limit: ${speedLimit} km/h`,
                  position: 'insideRight',
                  fill: 'hsl(5, 53%, 51%)',
                  fontSize: 12,
                  fontWeight: 600,
                  dy: -10
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Elevation Chart (Brush - 25% height) */}
      {hasElevation && (
        <div className="flex-[2.5] w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={sampledElevationData}
              margin={chartMargin}
              onMouseMove={(e) => handleMouseMove(e, 'elevation')}
              onMouseLeave={handleMouseLeave}
              onMouseDown={(e) => handleMouseDown(e, 'elevation')}
              onMouseUp={handleMouseUp}
            >
              <defs>
                <linearGradient id="elevationGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(23, 5%, 82%)" opacity={0.3} />
              <XAxis
                dataKey="distance"
                type="number"
                domain={[minDistance, maxDistance]}
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickCount={8}
                tickFormatter={(value) => `${Math.round(value)} km`}
                allowDataOverflow
              />
              <YAxis
                stroke="hsl(0, 0%, 60%)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => Math.round(value).toString()}
                width={60}
                domain={[minElevation - elevationRange * 0.1, maxElevation + elevationRange * 0.1]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(60, 9%, 94%)",
                  border: "1px solid hsl(60, 5%, 85%)",
                  borderRadius: "12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
                formatter={(value: number) => [`${value} m`, "Elevation"]}
                labelFormatter={(label) => `Distance: ${label} km`}
              />
              <Area
                type="monotone"
                dataKey="elevation"
                stroke="hsl(0, 0%, 50%)"
                strokeWidth={1.5}
                fill="url(#elevationGradient)"
                isAnimationActive={false}
              />

              {/* Show selection area when dragging on elevation chart */}
              {activeChart === 'elevation' && refAreaLeft && refAreaRight && (
                <ReferenceArea
                  x1={refAreaLeft}
                  x2={refAreaRight}
                  strokeOpacity={0.3}
                  fill="hsl(15, 52%, 58%)"
                  fillOpacity={0.3}
                />
              )}

              {/* Show current zoom range as highlighted area */}
              {zoomRange && (
                <ReferenceArea
                  x1={fullData.find(d => d.pointIndex >= zoomRange[0])?.distance || minDistance}
                  x2={fullData.find(d => d.pointIndex >= zoomRange[1])?.distance || maxDistance}
                  strokeOpacity={0.5}
                  stroke="hsl(15, 52%, 58%)"
                  strokeWidth={2}
                  fill="hsl(15, 52%, 58%)"
                  fillOpacity={0.15}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default SpeedElevationChart;
