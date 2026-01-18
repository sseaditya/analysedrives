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
import { useState, useMemo, useEffect } from "react";

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
  originalSpeed: number; // For scaling Y-axis correctly even when visual limit is applied
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

type InteractionMode = 'none' | 'new-selection' | 'resize-left' | 'resize-right' | 'move-window';

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
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('none');
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');
  const [dragStartDist, setDragStartDist] = useState<number | null>(null);
  const [hoverDistance, setHoverDistance] = useState<number | null>(null);
  const [hoveredPart, setHoveredPart] = useState<'left' | 'right' | 'center' | null>(null);

  // Calculate combined data for chart - Keep MORE points for better zoom detail
  const fullData: ChartDataPoint[] = useMemo(() => {
    const rawData: { dist: number; speed: number; ele: number | null; time: Date | undefined }[] = [];
    let cumulativeDistance = 0;

    // Dynamic Acceleration Limit
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

          const prevSpeedKmh = prevSpeedMps * 3.6;
          const maxAccel = getMaxAccel(prevSpeedKmh);
          const accel = (rawSpeedMps - prevSpeedMps) / timeDiff;

          if (accel > maxAccel) {
            speedMps = prevSpeedMps + (maxAccel * timeDiff);
            speedKmh = speedMps * 3.6;
          } else {
            speedKmh = rawSpeedKmh;
            speedMps = rawSpeedMps;
          }

          if (speedKmh > 350) speedKmh = prevSpeedMps * 3.6;
        }
      }

      prevSpeedMps = speedMps;

      rawData.push({
        dist: parseFloat(cumulativeDistance.toFixed(2)),
        speed: speedKmh,
        ele: curr.ele !== undefined ? curr.ele : null,
        time: curr.time
      });
    }

    // Apply smoothing and create final dataset
    const WINDOW_SIZE = 5;
    const offset = Math.floor(WINDOW_SIZE / 2);
    const result: ChartDataPoint[] = [];

    // Sample to ~1000 points to keep good granularity for zooming
    // This gives us enough detail when we zoom in and re-sample to 300
    const sampleRate = Math.max(1, Math.floor(points.length / 1000));

    for (let i = 0; i < rawData.length; i++) {
      const originalIndex = i + 1;

      // Sample all data points (no zoom filtering here)
      const shouldSample = (originalIndex % sampleRate === 0) || originalIndex === points.length - 1;

      if (shouldSample) {
        // Calculate smoothed speed
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

        let finalSpeed = parseFloat(smoothedSpeed.toFixed(1));
        const originalSpeed = finalSpeed; // Keep pure smoothed speed for Y-axis scaling

        if (speedCap && finalSpeed > speedCap) finalSpeed = speedCap;
        if (visualLimit && finalSpeed > visualLimit) finalSpeed = visualLimit;

        result.push({
          distance: rawData[i].dist,
          speed: finalSpeed,
          originalSpeed: originalSpeed,
          elevation: rawData[i].ele,
          time: rawData[i].time ? rawData[i].time!.toLocaleTimeString() : '',
          pointIndex: originalIndex,
        });
      }
    }

    return result;
  }, [points, speedCap, visualLimit]);

  if (fullData.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
        No data available to display chart
      </div>
    );
  }

  const hasElevation = fullData.some((d) => d.elevation !== null);

  // Calculate True Max Speed from ORIGINAL data (unaffected by clamping)
  const trueMaxSpeed = Math.max(...fullData.map(d => d.originalSpeed), 0);

  // Speed chart data: filter by zoom, then sample to EXACTLY 300 points
  const speedChartData = useMemo(() => {
    const filtered = zoomRange
      ? fullData.filter(d => d.pointIndex >= zoomRange[0] && d.pointIndex <= zoomRange[1])
      : fullData;

    // Always sample to exactly 300 points for consistent density
    const targetPoints = 300;
    if (filtered.length <= targetPoints) return filtered;

    const sampleRate = filtered.length / targetPoints;
    const sampled: ChartDataPoint[] = [];

    for (let i = 0; i < targetPoints; i++) {
      const idx = Math.floor(i * sampleRate);
      if (idx < filtered.length) {
        sampled.push(filtered[idx]);
      }
    }

    // Always include the last point
    if (sampled[sampled.length - 1] !== filtered[filtered.length - 1]) {
      sampled.push(filtered[filtered.length - 1]);
    }

    return sampled;
  }, [fullData, zoomRange]);

  // Calculate elevation range for better scaling
  const elevations = fullData.map((d) => d.elevation).filter((e): e is number => e !== null);
  const minElevation = elevations.length > 0 ? Math.min(...elevations) : 0;
  const maxElevation = elevations.length > 0 ? Math.max(...elevations) : 1000;
  const elevationRange = maxElevation - minElevation || 100;

  // Calculate distance domains
  const fullMinDistance = fullData[0]?.distance || 0;
  const fullMaxDistance = fullData[fullData.length - 1]?.distance || 100;

  // Speed chart domain - DYNAMIC based on zoom
  const speedMinDistance = speedChartData[0]?.distance || fullMinDistance;
  const speedMaxDistance = speedChartData[speedChartData.length - 1]?.distance || fullMaxDistance;

  // Get current zoom range boundaries for brush interaction
  const zoomStartDist = zoomRange ? fullData.find(d => d.pointIndex >= zoomRange[0])?.distance || fullMinDistance : null;
  const zoomEndDist = zoomRange ? fullData.find(d => d.pointIndex >= zoomRange[1])?.distance || fullMaxDistance : null;

  // Edge detection threshold (in distance units) - 3% for better UX
  const EDGE_THRESHOLD = (fullMaxDistance - fullMinDistance) * 0.03;

  const getInteractionMode = (distanceValue: number): InteractionMode => {
    if (!zoomStartDist || !zoomEndDist) return 'new-selection';

    const distToLeft = Math.abs(distanceValue - zoomStartDist);
    const distToRight = Math.abs(distanceValue - zoomEndDist);

    if (distToLeft < EDGE_THRESHOLD) return 'resize-left';
    if (distToRight < EDGE_THRESHOLD) return 'resize-right';
    if (distanceValue > zoomStartDist && distanceValue < zoomEndDist) return 'move-window';
    return 'new-selection';
  };

  const getCursorForMode = (mode: InteractionMode): string => {
    switch (mode) {
      case 'resize-left':
      case 'resize-right':
        return 'ew-resize';
      case 'move-window':
        return 'grab';
      case 'new-selection':
      default:
        return 'crosshair';
    }
  };

  const zoom = () => {
    if (refAreaLeft === refAreaRight || refAreaRight === null || refAreaLeft === null) {
      // Click (Reset zoom)
      if (zoomRange) {
        onZoomChange(null);
      }
      setRefAreaLeft(null);
      setRefAreaRight(null);
      setActiveChart(null);
      setInteractionMode('none');
      setDragStartDist(null);
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

      // Ensure minimum points
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
    setInteractionMode('none');
    setDragStartDist(null);
  };

  const handleMouseMove = (e: any, chartType: 'speed' | 'elevation') => {
    // Update hover distance for sync lines
    if (e?.activeLabel) {
      setHoverDistance(parseFloat(e.activeLabel));
    }

    // Update cursor based on hover position (elevation chart only)
    if (chartType === 'elevation' && e?.activeLabel && !refAreaLeft) {
      const dist = parseFloat(e.activeLabel);
      const mode = getInteractionMode(dist);
      setCursorStyle(getCursorForMode(mode));

      // Update hover part state
      if (mode === 'resize-left') setHoveredPart('left');
      else if (mode === 'resize-right') setHoveredPart('right');
      else if (mode === 'move-window') setHoveredPart('center');
      else setHoveredPart(null);
    } else if (chartType === 'speed') {
      // Reset interaction hovering if on speed chart
      setHoveredPart(null);
    }

    if (refAreaLeft && activeChart === chartType) {
      // dragging
      if (e.activeLabel) {
        const currentDist = parseFloat(e.activeLabel);

        if (interactionMode === 'move-window' && zoomStartDist && zoomEndDist && dragStartDist !== null) {
          // Move entire window
          const delta = currentDist - dragStartDist;
          const windowSize = zoomEndDist - zoomStartDist;

          let newStart = zoomStartDist + delta;
          let newEnd = zoomEndDist + delta;

          // Constrain to bounds
          if (newStart < fullMinDistance) {
            newStart = fullMinDistance;
            newEnd = newStart + windowSize;
          }
          if (newEnd > fullMaxDistance) {
            newEnd = fullMaxDistance;
            newStart = newEnd - windowSize;
          }

          setRefAreaLeft(newStart.toString());
          setRefAreaRight(newEnd.toString());
        } else if (interactionMode === 'resize-left' && zoomEndDist) {
          // Resize from left edge
          setRefAreaLeft(currentDist.toString());
          setRefAreaRight(zoomEndDist.toString());
        } else if (interactionMode === 'resize-right' && zoomStartDist) {
          // Resize from right edge
          setRefAreaLeft(zoomStartDist.toString());
          setRefAreaRight(currentDist.toString());
        } else {
          // New selection
          setRefAreaRight(e.activeLabel);
        }
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
      const dist = parseFloat(e.activeLabel);

      if (chartType === 'elevation') {
        const mode = getInteractionMode(dist);
        setInteractionMode(mode);

        if (mode === 'move-window') {
          setDragStartDist(dist);
          setRefAreaLeft(zoomStartDist?.toString() || null);
          setRefAreaRight(zoomEndDist?.toString() || null);
          setCursorStyle('grabbing');
        } else {
          setRefAreaLeft(e.activeLabel);
          setRefAreaRight(null);
          setDragStartDist(null);
        }
      } else {
        setRefAreaLeft(e.activeLabel);
        setRefAreaRight(null);
        setInteractionMode('new-selection');
        setDragStartDist(null);
      }

      setActiveChart(chartType);
    }
  };

  const handleMouseUp = () => {
    zoom();
    setCursorStyle(interactionMode === 'move-window' ? 'grab' : getCursorForMode(interactionMode));
  };

  const handleMouseLeave = () => {
    // Clear hover visual feedback
    if (onHover) onHover(null);
    setHoverDistance(null);
    setHoveredPart(null);

    // Only reset interaction interaction if NOT currently performing an action
    if (!activeChart) {
      setRefAreaLeft(null);
      setRefAreaRight(null);
      setInteractionMode('none');
      setCursorStyle('crosshair');
      setDragStartDist(null);
    }
  };

  // Handle global mouse up to catch interactions ending outside the chart
  useEffect(() => {
    if (!activeChart) return;

    const handleGlobalMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [activeChart, handleMouseUp]);

  // Shared margin configuration
  const chartMargin = { top: 10, right: 30, left: 0, bottom: 0 };

  // Calculate Y-axis domain for speed chart
  // ONLY speedCap affects the domain, speedLimit does NOT
  // Use original speed max to prevent rescaling when visual limit is applied
  const speedYDomain = [0, speedCap ? speedCap : Math.ceil(trueMaxSpeed / 10) * 10];

  return (
    <div className="h-full w-full rounded-2xl border border-border bg-card p-3 select-none flex flex-col cursor-crosshair">
      {/* Speed Chart (Main - 70% height) */}
      <div className="flex-[7] w-full min-h-0 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={speedChartData}
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
              domain={[speedMinDistance, speedMaxDistance]}
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
              domain={speedYDomain}
            />
            {/* Tooltip disabled - hover data shown in header */}
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

            {/* Synchronized Hover Line */}
            {hoverDistance !== null && (
              <ReferenceLine
                x={hoverDistance}
                stroke="hsl(var(--foreground))"
                strokeOpacity={1}
                isFront={true}
              />
            )}

            {/* Speed Limit Line - Same color as speed chart, moves with slider */}
            {speedLimit && (
              <ReferenceLine
                y={speedLimit}
                stroke="hsl(15, 52%, 58%)"
                strokeWidth={2.5}
                strokeOpacity={0.85}
                label={{
                  value: `${speedLimit} km/h`,
                  position: 'right',
                  fill: 'hsl(15, 52%, 58%)',
                  fontSize: 11,
                  fontWeight: 600,
                  offset: 10
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Elevation Chart (Brush - 25% height) */}
      {hasElevation && (
        <div className="flex-[2.5] w-full min-h-0" style={{ cursor: cursorStyle }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={fullData}
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
                domain={[fullMinDistance, fullMaxDistance]}
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
              {/* Tooltip disabled - hover data shown in header */}
              <Area
                type="monotone"
                dataKey="elevation"
                stroke="hsl(0, 0%, 50%)"
                strokeWidth={1.5}
                fill="url(#elevationGradient)"
                isAnimationActive={false}
              />

              {/* Synchronized Hover Line */}
              {hoverDistance !== null && (
                <ReferenceLine
                  x={hoverDistance}
                  stroke="hsl(var(--foreground))"
                  strokeOpacity={1}
                  isFront={true}
                />
              )}

              {/* Show selection area when dragging */}
              {activeChart === 'elevation' && refAreaLeft && refAreaRight && (
                <ReferenceArea
                  x1={refAreaLeft}
                  x2={refAreaRight}
                  strokeOpacity={0.3}
                  fill="hsl(15, 52%, 58%)"
                  fillOpacity={0.3}
                />
              )}

              {/* Visual handles for current zoom range */}
              {zoomRange && zoomStartDist && zoomEndDist && (
                <>
                  {/* Main selection area */}
                  <ReferenceArea
                    x1={zoomStartDist}
                    x2={zoomEndDist}
                    strokeOpacity={0.6}
                    stroke="hsl(15, 52%, 58%)"
                    strokeWidth={2}
                    fill="hsl(15, 52%, 58%)"
                    fillOpacity={hoveredPart === 'center' ? 0.35 : 0.15}
                  />
                  {/* Left edge handle - thicker for better visibility */}
                  <ReferenceLine
                    x={zoomStartDist}
                    stroke={hoveredPart === 'left' ? "hsl(var(--foreground))" : "hsl(15, 52%, 58%)"}
                    strokeWidth={hoveredPart === 'left' ? 8 : 6}
                    strokeOpacity={0.95}
                  />
                  {/* Right edge handle - thicker for better visibility */}
                  <ReferenceLine
                    x={zoomEndDist}
                    stroke={hoveredPart === 'right' ? "hsl(var(--foreground))" : "hsl(15, 52%, 58%)"}
                    strokeWidth={hoveredPart === 'right' ? 8 : 6}
                    strokeOpacity={0.95}
                  />
                </>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default SpeedElevationChart;
