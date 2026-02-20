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
import { GPXPoint, haversineDistance, PAUSE_THRESHOLD } from "@/utils/gpxParser";
import { calculateNiceTicks, calculateNiceYTicks } from "@/utils/chartUtils";
import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface SpeedElevationChartProps {
  points: GPXPoint[];
  onHover?: (point: GPXPoint | null, speed?: number, pointIndex?: number) => void;
  onZoomChange: (range: [number, number] | null) => void;
  zoomRange: [number, number] | null;
  speedLimit?: number | null;
  speedCap?: number | null;
  visualLimit?: number;
  xAxisMode?: 'distance' | 'time';
}

interface ChartDataPoint {
  distance: number;
  speed: number;
  originalSpeed: number; // For scaling Y-axis correctly even when visual limit is applied
  elevation: number | null;
  time: string;
  elapsedTime: number; // Elapsed time in seconds from start
  pointIndex: number;
}

// Format elapsed time for axis display (e.g., "5:30" for 5 min 30 sec)
// Format elapsed time for axis display (e.g., "30m", "1h", "1h 30m")
function formatTimeAxis(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}



// Helper to calculate "nice" ticks (multiples of 10, 20, 50, etc.)


type InteractionMode = 'none' | 'new-selection' | 'resize-left' | 'resize-right' | 'move-window';

const SpeedElevationChart = ({
  points,
  onHover,
  onZoomChange,
  zoomRange,
  speedLimit,
  speedCap,
  visualLimit,
  xAxisMode = 'distance'
}: SpeedElevationChartProps) => {
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<'speed' | 'elevation' | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('none');
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');
  const [dragStartDist, setDragStartDist] = useState<number | null>(null);
  const [hoverDistance, setHoverDistance] = useState<number | null>(null);
  const [hoveredPart, setHoveredPart] = useState<'left' | 'right' | 'center' | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const isMobile = useIsMobile();

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Calculate combined data for chart - Keep MORE points for better zoom detail
  const fullData: ChartDataPoint[] = useMemo(() => {
    const rawData: { dist: number; speed: number; ele: number | null; time: Date | undefined; elapsed: number }[] = [];

    // Track cumulative active time (excluding pauses)
    let cumulativeActiveTime = 0;
    let cumulativeDistance = 0;

    // Dynamic Acceleration Limit
    const getMaxAccel = (speedKmh: number) => {
      return Math.max(2.0, 9.0 - (speedKmh / 25.0));
    };

    let prevSpeedMps = 0;

    // Use rawData to push processed points.
    // Initialize first point
    if (points.length > 0) {
      rawData.push({
        dist: 0,
        speed: 0,
        ele: points[0].ele !== undefined ? points[0].ele : null,
        time: points[0].time,
        elapsed: 0
      });
    }

    // PAUSE_THRESHOLD derived from gpxParser
    // const PAUSE_THRESHOLD = 60.0; // Already imported

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      const distance = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
      // NOTE: We only add distance if it's NOT a pause? 
      // gpxParser stops adding cumulative distance during pause too.
      // But here we need to decide if we filter the point entirely or just freeze time/dist.
      // If we freeze, we get multiple points at same X.
      // Better to check time diff first.

      let timeDiff = 0;
      if (prev.time && curr.time) {
        timeDiff = (curr.time.getTime() - prev.time.getTime()) / 1000;
      }

      // If Pause, SKIP adding this segment to stats/accumulators
      //effectively stitching the graph
      if (timeDiff > PAUSE_THRESHOLD) {
        // We still iterate, but we don't increment cumulative Time or Distance?
        // If we don't increment Time, x-axis stays same.
        // If we don't increment Distance, distance-axis stays same.
        // But the point 'curr' exists. If we push it with same X, we get a vertical stack.
        // The user complained "paused section turns up as a line".
        // To fix, we should probably SKIP pushing this point to rawData, or push it with same coords (invisible)?
        // gpxParser's generateProcessedTrack effectively freezes time/dist.
        // Let's replicate that: timeDiff is effectively ignored for accumulation.
        continue; // Skip this point entirely? 
        // If we skip, we lose the point 'curr'.
        // But 'curr' is the start of the next segment.
        // If we skip 'curr', the next iteration will be i+1 vs i=curr.
        // Wait, loop is 1..length.
        // If we continue, we don't push 'curr'.
        // The next iteration calculates dist(points[i], points[i+1]). 
        // So we strictly lose 'curr' from the chart. That seems correct for a "gap".
      }

      cumulativeDistance += distance;
      cumulativeActiveTime += timeDiff;

      let speedKmh = 0;
      let speedMps = 0;

      if (timeDiff > 0) {
        const rawSpeedKmh = distance / (timeDiff / 3600);
        const rawSpeedMps = rawSpeedKmh / 3.6;

        const prevSpeedKmh = prevSpeedMps * 3.6;
        const maxAccel = getMaxAccel(prevSpeedKmh);
        // const accel = (rawSpeedMps - prevSpeedMps) / timeDiff;

        // Simple Accel Limit Check (Replicating gpxParser but locally)
        // Ideally we used processedPoints but this component takes raw points.
        // For now, simple check:
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

      prevSpeedMps = speedMps;

      rawData.push({
        dist: parseFloat(cumulativeDistance.toFixed(2)),
        speed: speedKmh,
        ele: curr.ele !== undefined ? curr.ele : null,
        time: curr.time,
        elapsed: cumulativeActiveTime // Use accumulated active time
      });
    }

    // Apply smoothing and create final dataset
    const WINDOW_SIZE = 5;
    const offset = Math.floor(WINDOW_SIZE / 2);
    const result: ChartDataPoint[] = [];

    // Sample points - fewer on mobile for better performance
    // Mobile: ~400 points, Desktop: ~1000 points
    const targetPoints = isMobile ? 200 : 500;
    const sampleRate = Math.max(1, Math.floor(points.length / targetPoints));

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
          elapsedTime: rawData[i].elapsed,
          pointIndex: originalIndex,
        });
      }
    }

    return result;
  }, [points, speedCap, visualLimit]);

  /* REMOVED EARLY RETURN TO FIX REACT ERROR #300 (HOOKS ORDER) 
  if (fullData.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
        No data available to display chart
      </div>
    );
  }
  */

  const hasElevation = useMemo(() => fullData.length > 0 && fullData.some((d) => d.elevation !== null), [fullData]);

  // Calculate True Max Speed from ORIGINAL data (unaffected by clamping)
  const trueMaxSpeed = useMemo(() => {
    if (fullData.length === 0) return 0;
    let max = 0;
    for (let i = 0; i < fullData.length; i++) {
      if (fullData[i].originalSpeed > max) max = fullData[i].originalSpeed;
    }
    return max;
  }, [fullData]);

  // Speed chart data: filter by zoom range (same ~1000 points as elevation)
  const speedChartData = useMemo(() => {
    if (fullData.length === 0) return [];
    if (!zoomRange) return fullData;
    return fullData.filter(d => d.pointIndex >= zoomRange[0] && d.pointIndex <= zoomRange[1]);
  }, [fullData, zoomRange]);

  // Calculate elevation range for better scaling (memoized)
  const { minElevation, maxElevation, elevationRange } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < fullData.length; i++) {
      const e = fullData[i].elevation;
      if (e !== null) {
        if (e < min) min = e;
        if (e > max) max = e;
      }
    }
    if (min === Infinity) { min = 0; max = 1000; }
    return { minElevation: min, maxElevation: max, elevationRange: (max - min) || 100 };
  }, [fullData]);

  // Calculate nice elevation Y-axis ticks
  const elevationYAxisConfig = useMemo(() => {
    return calculateNiceYTicks(minElevation - elevationRange * 0.05, maxElevation + elevationRange * 0.05, 3);
  }, [minElevation, maxElevation, elevationRange]);

  // Calculate distance domains
  const fullMinDistance = fullData[0]?.distance || 0;
  const fullMaxDistance = fullData[fullData.length - 1]?.distance || 100;

  // Calculate time domains (for time mode)
  const fullMinTime = fullData[0]?.elapsedTime || 0;
  const fullMaxTime = fullData[fullData.length - 1]?.elapsedTime || 0;

  // Speed chart domain - DYNAMIC based on zoom
  const speedMinDistance = speedChartData[0]?.distance || fullMinDistance;
  const speedMaxDistance = speedChartData[speedChartData.length - 1]?.distance || fullMaxDistance;
  const speedMinTime = speedChartData[0]?.elapsedTime || fullMinTime;
  const speedMaxTime = speedChartData[speedChartData.length - 1]?.elapsedTime || fullMaxTime;

  // Determine X-axis configuration based on mode
  const xAxisDataKey = xAxisMode === 'time' ? 'elapsedTime' : 'distance';
  const speedXDomain = xAxisMode === 'time' ? [speedMinTime, speedMaxTime] : [speedMinDistance, speedMaxDistance];
  const fullXDomain = xAxisMode === 'time' ? [fullMinTime, fullMaxTime] : [fullMinDistance, fullMaxDistance];
  const xAxisFormatter = useCallback((value: number) => {
    if (xAxisMode === 'time') {
      return formatTimeAxis(value);
    }
    // Distance: show decimals if step is fractional, otherwise integer
    const isInteger = value % 1 === 0;
    return isInteger ? `${Math.round(value)} km` : `${parseFloat(value.toFixed(1))} km`;
  }, [xAxisMode]);

  // Get current zoom range boundaries for brush interaction (memoized to avoid linear scans per render)
  const { zoomStartVal, zoomEndVal, fullMinVal, fullMaxVal } = useMemo(() => {
    const fMinVal = xAxisMode === 'time' ? fullMinTime : fullMinDistance;
    const fMaxVal = xAxisMode === 'time' ? fullMaxTime : fullMaxDistance;

    if (!zoomRange) return { zoomStartVal: null, zoomEndVal: null, fullMinVal: fMinVal, fullMaxVal: fMaxVal };

    let startVal: number | null = null;
    let endVal: number | null = null;

    for (let i = 0; i < fullData.length; i++) {
      if (startVal === null && fullData[i].pointIndex >= zoomRange[0]) {
        startVal = xAxisMode === 'time' ? fullData[i].elapsedTime : fullData[i].distance;
      }
      if (endVal === null && fullData[i].pointIndex >= zoomRange[1]) {
        endVal = xAxisMode === 'time' ? fullData[i].elapsedTime : fullData[i].distance;
        break;
      }
    }

    return {
      zoomStartVal: startVal ?? fMinVal,
      zoomEndVal: endVal ?? fMaxVal,
      fullMinVal: fMinVal,
      fullMaxVal: fMaxVal
    };
  }, [zoomRange, fullData, xAxisMode, fullMinTime, fullMaxTime, fullMinDistance, fullMaxDistance]);

  // Calculate strict ticks for synchro
  const xAxisTicks = useMemo(() => {
    return calculateNiceTicks(
      speedXDomain[0],
      speedXDomain[1],
      xAxisMode,
      8 // Approx 7-8 ticks
    );
  }, [speedXDomain, xAxisMode]);

  // Memoize elevation chart X-axis ticks (previously calculated inline in JSX)
  const elevationXTicks = useMemo(() => {
    return calculateNiceTicks(fullXDomain[0], fullXDomain[1], xAxisMode, 8);
  }, [fullXDomain, xAxisMode]);

  // Edge detection threshold - 1% for better UX (Reduced from 3%)
  const EDGE_THRESHOLD = (fullMaxVal - fullMinVal) * 0.01;

  const getInteractionMode = useCallback((val: number): InteractionMode => {
    // Safety check for empty data
    if (zoomStartVal === null || zoomEndVal === null) return 'new-selection';

    if (Math.abs(val - zoomStartVal) < EDGE_THRESHOLD) return 'resize-left';
    if (Math.abs(val - zoomEndVal) < EDGE_THRESHOLD) return 'resize-right';
    if (val > zoomStartVal && val < zoomEndVal) return 'move-window';

    return 'new-selection';
  }, [zoomStartVal, zoomEndVal, EDGE_THRESHOLD]);


  const getCursorForMode = useCallback((mode: InteractionMode): string => {
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
  }, []);

  const zoom = useCallback(() => {
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

    // Identify start/end values
    let leftVal = parseFloat(refAreaLeft);
    let rightVal = parseFloat(refAreaRight);

    if (leftVal > rightVal) [leftVal, rightVal] = [rightVal, leftVal];

    const startData = fullData.find(p => xAxisMode === 'time' ? p.elapsedTime >= leftVal : p.distance >= leftVal);
    const endData = fullData.find(p => xAxisMode === 'time' ? p.elapsedTime >= rightVal : p.distance >= rightVal);

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
  }, [refAreaLeft, refAreaRight, zoomRange, onZoomChange, fullData, xAxisMode, points.length]);

  const handleMouseMoveInner = useCallback((e: any, chartType: 'speed' | 'elevation') => {
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
        const currentVal = parseFloat(e.activeLabel);

        if (interactionMode === 'move-window' && zoomStartVal !== null && zoomEndVal !== null && dragStartDist !== null) {
          // Move entire window
          const delta = currentVal - dragStartDist;
          const windowSize = zoomEndVal - zoomStartVal;

          let newStart = zoomStartVal + delta;
          let newEnd = zoomEndVal + delta;

          // Constrain to bounds
          if (newStart < fullMinVal) {
            newStart = fullMinVal;
            newEnd = newStart + windowSize;
          }
          if (newEnd > fullMaxVal) {
            newEnd = fullMaxVal;
            newStart = newEnd - windowSize;
          }

          setRefAreaLeft(newStart.toString());
          setRefAreaRight(newEnd.toString());
        } else if (interactionMode === 'resize-left' && zoomEndVal !== null) {
          // Resize from left edge
          setRefAreaLeft(currentVal.toString());
          setRefAreaRight(zoomEndVal.toString());
        } else if (interactionMode === 'resize-right' && zoomStartVal !== null) {
          // Resize from right edge
          setRefAreaLeft(zoomStartVal.toString());
          setRefAreaRight(currentVal.toString());
        } else {
          // New selection
          setRefAreaRight(e.activeLabel);
        }
      }
    }

    // Skip hover callback on mobile to remove floating data display
    // Also skip during active drag to prevent parent re-renders
    if (isMobile || activeChart) return;

    if (!e || !e.activePayload || !e.activePayload[0] || !onHover) {
      return;
    }

    const activeData = e.activePayload[0].payload as ChartDataPoint;
    const pointIndex = activeData.pointIndex;

    if (pointIndex !== undefined && pointIndex < points.length) {
      onHover(points[pointIndex], activeData.speed, pointIndex);
    }
  }, [refAreaLeft, activeChart, interactionMode, zoomStartVal, zoomEndVal, dragStartDist, fullMinVal, fullMaxVal, isMobile, onHover, points, getInteractionMode, getCursorForMode]);

  // Throttle mouse moves to once per animation frame for smooth 60fps interaction
  const handleMouseMove = useCallback((e: any, chartType: 'speed' | 'elevation') => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      handleMouseMoveInner(e, chartType);
    });
  }, [handleMouseMoveInner]);

  const handleMouseDown = useCallback((e: any, chartType: 'speed' | 'elevation') => {
    if (isMobile) return; // Disable selection on mobile
    if (e && e.activeLabel) {
      const dist = parseFloat(e.activeLabel);

      if (chartType === 'elevation') {
        const mode = getInteractionMode(dist);
        setInteractionMode(mode);

        if (mode === 'move-window') {
          setDragStartDist(dist);
          setRefAreaLeft(zoomStartVal?.toString() || null);
          setRefAreaRight(zoomEndVal?.toString() || null);
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
  }, [isMobile, getInteractionMode, zoomStartVal, zoomEndVal]);

  const handleMouseUp = useCallback(() => {
    zoom();
    setCursorStyle(interactionMode === 'move-window' ? 'grab' : getCursorForMode(interactionMode));
  }, [zoom, interactionMode, getCursorForMode]);

  const handleMouseLeave = useCallback(() => {
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
  }, [onHover, activeChart]);

  // Handle global mouse up to catch interactions ending outside the chart
  useEffect(() => {
    if (!activeChart) return;

    // Separate logic for snapping when mouse is strictly OUT of bounds
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!chartRef.current) return;
      const rect = chartRef.current.getBoundingClientRect();
      // AreaChart has margin right 30. We approximate the chart area width.
      const effectiveWidth = rect.width - 30;

      // Relative X from left edge of chart area
      const x = e.clientX - rect.left;

      // Snapping Logic
      if (x < 0) {
        // SNAP LEFT
        if (interactionMode === 'move-window' && zoomStartVal !== null && zoomEndVal !== null) {
          const windowSize = zoomEndVal - zoomStartVal;
          setRefAreaLeft(fullMinVal.toString());
          setRefAreaRight((fullMinVal + windowSize).toString());
        } else if (interactionMode === 'resize-left') {
          setRefAreaLeft(fullMinVal.toString());
        } else if (interactionMode === 'resize-right') {
          setRefAreaRight(fullMinVal.toString());
        } else if (interactionMode === 'new-selection') {
          setRefAreaRight(fullMinVal.toString());
        }
      } else if (x > effectiveWidth) {
        // SNAP RIGHT
        if (interactionMode === 'move-window' && zoomStartVal !== null && zoomEndVal !== null) {
          const windowSize = zoomEndVal - zoomStartVal;
          setRefAreaRight(fullMaxVal.toString());
          setRefAreaLeft((fullMaxVal - windowSize).toString());
        } else if (interactionMode === 'resize-left') {
          setRefAreaLeft(fullMaxVal.toString());
        } else if (interactionMode === 'resize-right') {
          setRefAreaRight(fullMaxVal.toString());
        } else if (interactionMode === 'new-selection') {
          setRefAreaRight(fullMaxVal.toString());
        }
      }
    };

    const handleGlobalMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [activeChart, handleMouseUp, interactionMode, zoomStartVal, zoomEndVal, fullMinVal, fullMaxVal]);

  // Shared margin configuration
  const chartMargin = { top: 10, right: 30, left: 0, bottom: 0 };

  // Calculate Y-axis domain for speed chart
  // ONLY speedCap affects the domain, speedLimit does NOT
  // Use original speed max to prevent rescaling when visual limit is applied
  const speedYAxisConfig = useMemo(() => {
    const maxSpeed = speedCap ? speedCap : trueMaxSpeed;
    return calculateNiceYTicks(0, maxSpeed, 7);
  }, [speedCap, trueMaxSpeed]);

  if (fullData.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
        No data available to display chart
      </div>
    );
  }

  return (
    <div ref={chartRef} className="h-full w-full rounded-2xl border border-border bg-card p-3 select-none flex flex-col cursor-crosshair">
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
            {/* Custom Grid using ReferenceLines for Y-Axis (Horizontal) to ensure they ALWAYS render in Safari */}
            {speedYAxisConfig.ticks.map((tickVal) => (
              <ReferenceLine
                key={`grid-${tickVal}`}
                y={tickVal}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={0.5}
                strokeOpacity={0.6}
                isFront={false}
              />
            ))}
            {/* Vertical Grid using ReferenceLines for X-Axis to ensure Safari visibility */}
            {xAxisTicks.map((tickVal) => (
              <ReferenceLine
                key={`grid-x-${tickVal}`}
                x={tickVal}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={0.5}
                strokeOpacity={0.6}
                isFront={false}
              />
            ))}
            {/* Remove CartesianGrid entirely since we now handle both H and V manually */}
            <XAxis
              dataKey={xAxisDataKey}
              type="number"
              domain={speedXDomain}
              stroke="hsl(var(--foreground))"
              strokeOpacity={0.6}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              ticks={xAxisTicks} // Use custom nice ticks
              tickFormatter={xAxisFormatter}
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
              domain={speedYAxisConfig.domain}
              ticks={speedYAxisConfig.ticks}
              interval={0}
            />
            {/* Tooltip disabled - hover data shown in header */}
            <Area
              type="monotone"
              dataKey="speed"
              stroke="hsl(15, 52%, 58%)"
              strokeWidth={isMobile ? 1.5 : 3}
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
              {/* Explicit Grid Lines for Elevation Chart */}
              {/* Horizontal (Y) */}
              {elevationYAxisConfig.ticks.map((tickVal) => (
                <ReferenceLine
                  key={`grid-ele-y-${tickVal}`}
                  y={tickVal}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={0.5}
                  strokeOpacity={0.6}
                  isFront={false}
                />
              ))}
              {/* Vertical (X) - using same ticks as speed chart */}
              {/* We need to recalculate or reuse ticks. The XAxis below uses calculateNiceTicks */}
              {elevationXTicks.map((tickVal) => (
                <ReferenceLine
                  key={`grid-ele-x-${tickVal}`}
                  x={tickVal}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={0.5}
                  strokeOpacity={0.6}
                  isFront={false}
                />
              ))}
              <XAxis
                dataKey={xAxisDataKey}
                type="number"
                domain={fullXDomain} // Elevation chart acts as a brush (full view)
                stroke="hsl(var(--foreground))"
                strokeOpacity={0.6}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                ticks={elevationXTicks}
                tickFormatter={xAxisFormatter}
                allowDataOverflow
              />
              <YAxis
                stroke="hsl(0, 0%, 60%)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => Math.round(value).toString()}
                width={60}
                domain={elevationYAxisConfig.domain}
                ticks={elevationYAxisConfig.ticks}
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
              {zoomRange && zoomStartVal !== null && zoomEndVal !== null && (
                <>
                  {/* Main selection area */}
                  <ReferenceArea
                    x1={zoomStartVal}
                    x2={zoomEndVal}
                    strokeOpacity={0.6}
                    stroke="hsl(15, 52%, 58%)"
                    strokeWidth={2}
                    fill="hsl(15, 52%, 58%)"
                    fillOpacity={hoveredPart === 'center' ? 0.35 : 0.15}
                  />
                  {/* Left edge handle - thicker for better visibility */}
                  <ReferenceLine
                    x={zoomStartVal}
                    stroke={hoveredPart === 'left' ? "hsl(var(--foreground))" : "hsl(15, 52%, 58%)"}
                    strokeWidth={hoveredPart === 'left' ? 8 : 6}
                    strokeOpacity={0.95}
                  />
                  {/* Right edge handle - thicker for better visibility */}
                  <ReferenceLine
                    x={zoomEndVal}
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

export default memo(SpeedElevationChart);
