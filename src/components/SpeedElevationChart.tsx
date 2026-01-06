import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
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

const SpeedElevationChart = ({ points, onHover, onZoomChange, zoomRange, speedLimit, speedCap }: SpeedElevationChartProps) => {
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

  // Calculate combined data for chart
  const chartData: ChartDataPoint[] = [];
  let cumulativeDistance = 0;

  // First pass: Calculate all raw speeds and distances
  // We need raw data for every point to perform accurate smoothing before sampling
  const rawData: { dist: number; speed: number; ele: number | null; time: Date | undefined }[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const distance = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    cumulativeDistance += distance;

    let speed = 0;
    if (prev.time && curr.time) {
      const timeDiff = (curr.time.getTime() - prev.time.getTime()) / 1000 / 3600;
      if (timeDiff > 0) {
        speed = distance / timeDiff;
        if (speed > 200) speed = 0;
      }
    }

    rawData.push({
      dist: parseFloat(cumulativeDistance.toFixed(2)),
      speed,
      ele: curr.ele !== undefined ? curr.ele : null,
      time: curr.time
    });
  }

  // Second pass: Apply smoothing and sampling
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

    // 2. Sampling Logic
    // We sample based on the original point index (i+1 because rawData starts from points[1])
    const originalIndex = i + 1;

    // Sample data logic
    // Only add points if they are within the zoom range (if it exists)
    const isVisible = !zoomRange || (originalIndex >= zoomRange[0] && originalIndex <= zoomRange[1]);

    if (isVisible) {
      // Logic to reduce points density
      // Use dynamic sampling to target ~300 points max for performance
      let rangeSize = points.length;
      if (zoomRange) {
        rangeSize = zoomRange[1] - zoomRange[0];
      }

      const sampleRate = Math.max(1, Math.floor(rangeSize / 300));

      // Use originalIndex for modulo check to maintain consistent sampling
      const shouldSample = (originalIndex % sampleRate === 0) || originalIndex === points.length - 1 || (zoomRange && originalIndex === zoomRange[1]);

      if (shouldSample) {
        let finalSpeed = parseFloat(smoothedSpeed.toFixed(1));
        if (speedCap && finalSpeed > speedCap) {
          finalSpeed = speedCap;
        }

        chartData.push({
          distance: currRaw.dist,
          speed: finalSpeed,
          elevation: currRaw.ele !== undefined ? parseFloat(currRaw.ele.toFixed(1)) : null,
          time: currRaw.time ? currRaw.time.toLocaleTimeString() : "",
          pointIndex: originalIndex,
        });
      }
    }
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
        No data available to display chart
      </div>
    );
  }

  const hasElevation = chartData.some((d) => d.elevation !== null);
  const hasSpeed = chartData.some((d) => d.speed > 0);

  const zoom = () => {
    if (refAreaLeft === refAreaRight || refAreaRight === null || refAreaLeft === null) {
      // Logic for Click (Reset)
      if (zoomRange) { // Only reset if we are currently zoomed
        onZoomChange(null);
      }
      setRefAreaLeft(null);
      setRefAreaRight(null);
      return;
    }

    // Identify start/end distances
    let leftDist = parseFloat(refAreaLeft);
    let rightDist = parseFloat(refAreaRight);

    if (leftDist > rightDist) [leftDist, rightDist] = [rightDist, leftDist];

    const startData = chartData.find(p => p.distance >= leftDist);
    const endData = chartData.find(p => p.distance >= rightDist);

    if (startData && endData) {
      let startIndex = startData.pointIndex;
      let endIndex = endData.pointIndex;

      // Ensure we always have at least 5 points for context and visibility
      const MIN_POINTS = 5;
      const diff = endIndex - startIndex;

      if (diff < MIN_POINTS) {
        const padding = Math.ceil((MIN_POINTS - diff) / 2);
        startIndex = Math.max(0, startIndex - padding);
        endIndex = Math.min(points.length - 1, endIndex + padding);

        // If still not enough (edge case at ends), try to expand other way
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
  };

  // Handle mouse move to find closest point
  const handleMouseMove = (e: any) => {
    if (refAreaLeft) {
      // dragging
      if (e.activeLabel) {
        setRefAreaRight(e.activeLabel);
      }
    }

    if (!e || !e.activePayload || !e.activePayload[0] || !onHover) {
      if (onHover) onHover(null);
      return;
    }

    const activeData = e.activePayload[0].payload as ChartDataPoint;
    const pointIndex = activeData.pointIndex;

    if (pointIndex !== undefined && pointIndex < points.length) {
      onHover(points[pointIndex]);
    }
  };

  const handleMouseDown = (e: any) => {
    if (e && e.activeLabel) {
      setRefAreaLeft(e.activeLabel);
      // Reset right on new down press to ensure clean state
      setRefAreaRight(null);
    }
  };

  const handleMouseUp = () => {
    zoom();
  };

  const handleMouseLeave = () => {
    if (onHover) onHover(null);
    // Also cancel drag if leaving chart?
    // User might want to drag outside to snap to edge, but Recharts handles that poorly.
    // Safest is to reset drag state if they leave without dropping.
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  // Calculate elevation range for better scaling
  const elevations = chartData.map((d) => d.elevation).filter((e): e is number => e !== null);
  const minElevation = elevations.length > 0 ? Math.min(...elevations) : 0;
  const maxElevation = elevations.length > 0 ? Math.max(...elevations) : 1000;
  const elevationRange = maxElevation - minElevation || 100;

  return (
    <div className="h-full w-full rounded-2xl border border-border bg-card p-6 select-none">
      <div className="h-full w-full select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          >
            <defs>
              <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(37, 92%, 50%)" stopOpacity={0.6} />
                <stop offset="95%" stopColor="hsl(37, 92%, 50%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(23, 5%, 82%)" opacity={0.5} />
            <XAxis
              dataKey="distance"
              type="number"
              domain={["dataMin", "dataMax"]}
              stroke="#9ca3af"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickCount={8}
              tickFormatter={(value) => `${Math.round(value)} km`}
              allowDataOverflow
            />
            {/* Left Y-axis for Speed (more prominent) */}
            {hasSpeed && (
              <YAxis
                yAxisId="speed"
                stroke="hsl(37, 92%, 50%)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => Math.round(value).toString()}
                label={{ value: "Speed (km/h)", angle: -90, position: "insideLeft", fontSize: 12, fill: "hsl(37, 92%, 50%)" }}
                width={60}
                domain={[0, speedCap || 'auto']}
              />
            )}
            {/* Right Y-axis for Elevation */}
            {hasElevation && (
              <YAxis
                yAxisId="elevation"
                orientation="right"
                stroke="hsl(142, 76%, 36%)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => Math.round(value).toString()}
                label={{ value: "Elevation (m)", angle: 90, position: "insideRight", fontSize: 12, fill: "hsl(142, 76%, 36%)" }}
                width={60}
                domain={[minElevation - elevationRange * 0.1, maxElevation + elevationRange * 0.1]}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(60, 9%, 97%)",
                border: "1px solid hsl(23, 5%, 82%)",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              formatter={(value: number, name: string) => {
                if (name === "speed") return [`${value} km/h`, "Speed"];
                if (name === "elevation") return [`${value} m`, "Elevation"];
                return [value, name];
              }}
              labelFormatter={(label) => `Distance: ${label} km`}
            />
            {/* Speed Area (more prominent - thicker stroke, more visible fill) */}
            {hasSpeed && (
              <Area
                yAxisId="speed"
                type="monotone"
                dataKey="speed"
                stroke="hsl(37, 92%, 50%)"
                strokeWidth={3}
                fill="url(#speedGradient)"
                name="speed"
                isAnimationActive={false}
              />
            )}
            {/* Elevation Line (less prominent - thinner line, dashed) */}
            {hasElevation && (
              <Line
                yAxisId="elevation"
                type="monotone"
                dataKey="elevation"
                stroke="hsl(142, 76%, 36%)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="elevation"
                isAnimationActive={false}
              />
            )}

            {refAreaLeft && refAreaRight && (
              <ReferenceArea
                yAxisId="speed"
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="hsl(37, 92%, 50%)"
                fillOpacity={0.3}
              />
            )}

            {/* Speed Limit Reference Line - Bolder & Highlighted */}
            {speedLimit && (
              <ReferenceLine
                yAxisId="speed"
                y={speedLimit}
                stroke="hsl(0, 84%, 60%)" // Red-ish for visibility
                strokeWidth={4}
                strokeDasharray="4 4"
                strokeOpacity={0.9}
                label={{
                  value: `Limit: ${speedLimit} km/h`,
                  position: 'insideRight',
                  fill: 'hsl(0, 84%, 60%)',
                  fontSize: 12,
                  fontWeight: 800,
                  dy: -10
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SpeedElevationChart;

