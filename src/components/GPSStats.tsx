import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Clock,
  ArrowUpRight,
  Map as MapIcon,
  Download,
  Share2,
  Calendar,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Info,
  Fuel,
  Leaf,
  MapPin,
  TrendingUp,
  Compass,
  RotateCcw,
  MoveRight,
  GitCommit,
  Spline,
  Gauge,
  AlertTriangle,
  Globe,
  Lock,
  Pencil,
  Trophy,
  Play,
  Pause
} from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import TrackMap from "./TrackMap";
import SpeedElevationChart from "./SpeedElevationChart";
import SpeedDistributionChart from "./SpeedDistributionChart";
import DistanceTimeChart from "./DistanceTimeChart";
import ChartRangeSlider from "./ChartRangeSlider";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  GPXStats,
  GPXPoint,
  formatDistance,
  formatDuration,
  formatDurationShort,
  formatSpeed,
  haversineDistance,
  calculateLimitedStats,
  calculateStats,
  PAUSE_THRESHOLD
} from "@/utils/gpxParser";
import type { PublicProfilePoint } from "@/utils/publicActivity";
import type { ActivitySegmentRank } from "@/types/segments";

interface OwnerProfile {
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  car: string | null;
}

interface GPSStatsProps {
  stats: GPXStats;
  fileName: string;
  points: GPXPoint[];
  profilePoints?: PublicProfilePoint[];
  profilePointOffset?: number;
  speedCap?: number | null;
  displaySpeedCap?: number | null;
  isOwner?: boolean;
  isPublic?: boolean;
  description?: string | null;
  hideRadius?: number;
  ownerProfile?: OwnerProfile | null;
  onEdit?: () => void;
  fuel?: number | null;
  segmentRanks?: ActivitySegmentRank[];
}

const PROFILE_PLAYBACK_DURATION_MS = 30_000;
const PROFILE_PLAYBACK_FPS = 60;
const PROFILE_CURSOR_FPS = 20;
const AUTO_SPEED_AVERAGE_FRAME_RADIUS = 3;
const AUTO_SPEED_FRAME_STRIDE = 6;
const READOUT_INTERVAL_MS = 200;

function speedAtElapsed(cumulativeTime: Float64Array, speeds: Float64Array, elapsed: number) {
  if (cumulativeTime.length === 0 || elapsed <= 0) return speeds[0] ?? 0;
  const lastIndex = cumulativeTime.length - 1;
  if (elapsed >= cumulativeTime[lastIndex]) return speeds[lastIndex] ?? 0;

  let low = 1;
  let high = lastIndex;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulativeTime[middle] < elapsed) low = middle + 1;
    else high = middle;
  }
  const right = low;
  const left = right - 1;
  const span = cumulativeTime[right] - cumulativeTime[left];
  const ratio = span > 0 ? (elapsed - cumulativeTime[left]) / span : 1;
  return speeds[left] + (speeds[right] - speeds[left]) * ratio;
}

function frameAveragedSpeed(cumulativeTime: Float64Array, speeds: Float64Array, elapsed: number, frameStep: number) {
  const maximum = cumulativeTime[cumulativeTime.length - 1] ?? 0;
  let total = 0;
  let count = 0;
  for (let offset = -AUTO_SPEED_AVERAGE_FRAME_RADIUS; offset <= AUTO_SPEED_AVERAGE_FRAME_RADIUS; offset++) {
    const sampleElapsed = elapsed + offset * frameStep * AUTO_SPEED_FRAME_STRIDE;
    if (sampleElapsed < 0 || sampleElapsed > maximum) continue;
    total += speedAtElapsed(cumulativeTime, speeds, sampleElapsed);
    count++;
  }
  return count > 0 ? total / count : speedAtElapsed(cumulativeTime, speeds, elapsed);
}

function InfoPopover({ children, contentClassName }: { children: ReactNode; contentClassName?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="focus:outline-none"
          aria-label="More Information"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          <Info className="w-4 h-4 text-muted-foreground hover:text-foreground cursor-help" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn("max-w-xs text-xs", contentClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

const GPSStats = ({ stats: initialStats, fileName, points: initialPoints, profilePoints, profilePointOffset = 0, speedCap, displaySpeedCap, isOwner = true, isPublic = false, description, hideRadius = 0, ownerProfile, onEdit, fuel, segmentRanks = [] }: GPSStatsProps) => {
  const [hoveredPoint, setHoveredPoint] = useState<GPXPoint | null>(null);
  const [readoutPoint, setReadoutPoint] = useState<GPXPoint | null>(null);
  const [readoutSpeed, setReadoutSpeed] = useState<number | null>(null);
  const [readoutIndex, setReadoutIndex] = useState<number>(-1);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isProfilePlaying, setIsProfilePlaying] = useState(false);
  const [playbackElapsedTime, setPlaybackElapsedTime] = useState<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const playbackRafRef = useRef<number | null>(null);
  const playbackElapsedRef = useRef(0);
  const lastPlaybackCursorUpdateRef = useRef(Number.NEGATIVE_INFINITY);
  const lastReadoutUpdateRef = useRef(Number.NEGATIVE_INFINITY);

  // Cleanup hover rAF on unmount
  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
      if (playbackRafRef.current !== null) cancelAnimationFrame(playbackRafRef.current);
    };
  }, []);

  // Filter points based on privacy radius
  const { points, stats, privacyMask, mapPoints, mapPointsStartIndex } = useMemo(() => {
    if (profilePoints?.length) {
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: null,
        mapPoints: initialPoints,
        mapPointsStartIndex: profilePointOffset,
      };
    }

    if ((!hideRadius || hideRadius <= 0) && isOwner) {
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: null,
        mapPoints: initialPoints,
        mapPointsStartIndex: 0
      };
    }

    // Calculate cumulative distances to find cut-off points
    let cumulativeDist = 0;
    let startIndex = 0;
    let endIndex = initialPoints.length - 1;

    // Find start index (distance > hideRadius)
    if (hideRadius > 0) {
      for (let i = 1; i < initialPoints.length; i++) {
        const dist = haversineDistance(
          initialPoints[i - 1].lat, initialPoints[i - 1].lon,
          initialPoints[i].lat, initialPoints[i].lon
        );
        cumulativeDist += dist;
        if (cumulativeDist >= hideRadius) {
          startIndex = i;
          break;
        }
      }

      // Find end index (distance from end > hideRadius)
      cumulativeDist = 0;
      for (let i = initialPoints.length - 2; i >= 0; i--) {
        const dist = haversineDistance(
          initialPoints[i].lat, initialPoints[i].lon,
          initialPoints[i + 1].lat, initialPoints[i + 1].lon
        );
        cumulativeDist += dist;
        if (cumulativeDist >= hideRadius) {
          endIndex = i;
          break;
        }
      }
    }

    // Safety check: if start crosses end, showing nothing or very little
    if (startIndex >= endIndex) {
      if (!isOwner) return { points: initialPoints, stats: initialStats, privacyMask: null, mapPoints: [], mapPointsStartIndex: 0 };
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: { start: startIndex, end: endIndex },
        mapPoints: initialPoints,
        mapPointsStartIndex: 0
      };
    }

    if (!isOwner) {
      // Public viewer: Hide start/end on map Only
      // Keep full data for charts/stats
      const slicedPoints = initialPoints.slice(startIndex, endIndex + 1);
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: null,
        mapPoints: slicedPoints,
        mapPointsStartIndex: startIndex // Track the offset
      };
    } else {
      // Owner: Keep all points, but pass mask indices
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: { start: startIndex, end: endIndex },
        mapPoints: initialPoints,
        mapPointsStartIndex: 0
      };
    }
  }, [initialPoints, initialStats, hideRadius, isOwner, profilePoints, profilePointOffset]);

  // Calculate safe initial speed limit
  const initialSpeedLimit = useMemo(() => {
    let limit = Math.max(40, Math.floor((stats.maxSpeed * 0.8) / 10) * 10);
    if (speedCap) {
      limit = Math.min(limit, speedCap - 10);
    }
    return Math.max(40, limit);
  }, [stats.maxSpeed, speedCap]);

  const [speedLimit, setSpeedLimit] = useState<number>(initialSpeedLimit);
  const [showLimiter, setShowLimiter] = useState(false);
  const [xAxisMode, setXAxisMode] = useState<'distance' | 'time'>('distance');
  const isMobile = useIsMobile();

  const tabs = [
    { id: "overview", label: "Overview", icon: MapPin },
    { id: "structure", label: "Route Details", icon: Spline },
  ];

  const fastestDistanceEfforts = useMemo(() => {
    return (stats.fastestDistances ?? []).map((effort) => {
      if (isOwner || !speedCap || effort.averageSpeed <= speedCap) return effort;
      return {
        ...effort,
        averageSpeed: speedCap,
        elapsedTime: (effort.distanceKm / speedCap) * 3600,
      };
    });
  }, [stats.fastestDistances, isOwner, speedCap]);

  const terrainDistances = useMemo(() => {
    if (Number.isFinite(stats.descendingDistance) && Number.isFinite(stats.levelDistance)) {
      return {
        uphill: stats.climbDistance,
        downhill: stats.descendingDistance!,
        flat: stats.levelDistance!,
      };
    }

    const recalculated = calculateStats(initialPoints);
    return {
      uphill: recalculated.climbDistance,
      downhill: recalculated.descendingDistance ?? 0,
      flat: recalculated.levelDistance ?? 0,
    };
  }, [initialPoints, stats.climbDistance, stats.descendingDistance, stats.levelDistance]);

  // Calculate stats for the selected zoom range
  const { filteredPoints, subsetStats } = useMemo(() => {
    if (profilePoints?.length && zoomRange) {
      const start = Math.max(0, Math.min(profilePoints.length - 1, zoomRange[0]));
      const end = Math.max(start, Math.min(profilePoints.length - 1, zoomRange[1]));
      const selected = profilePoints.slice(start, end + 1);
      const distance = Math.max(0, (selected.at(-1)?.distance ?? 0) - (selected[0]?.distance ?? 0));
      let elapsed = Math.max(0, (selected.at(-1)?.elapsedTime ?? 0) - (selected[0]?.elapsedTime ?? 0));
      const rawAverageSpeed = elapsed > 0 ? distance / (elapsed / 3600) : 0;
      const averageSpeed = speedCap ? Math.min(speedCap, rawAverageSpeed) : rawAverageSpeed;
      if (speedCap && rawAverageSpeed > speedCap) elapsed = distance / speedCap * 3600;

      let elevationGain = 0;
      let elevationLoss = 0;
      for (let index = 1; index < selected.length; index++) {
        const previous = selected[index - 1].ele;
        const current = selected[index].ele;
        if (previous == null || current == null) continue;
        const difference = current - previous;
        if (difference > 0) elevationGain += difference;
        else elevationLoss += Math.abs(difference);
      }

      return {
        filteredPoints: points,
        subsetStats: {
          ...stats,
          totalDistance: distance,
          totalTime: elapsed,
          movingTime: elapsed,
          stoppedTime: 0,
          avgSpeed: averageSpeed,
          movingAvgSpeed: averageSpeed,
          maxSpeed: selected.reduce((maximum, point) => Math.max(maximum, point.speed), 0),
          elevationGain,
          elevationLoss,
        },
      };
    }

    if (!zoomRange || !points.length) {
      return { filteredPoints: points, subsetStats: null };
    }

    const [startIndex, endIndex] = zoomRange;
    // Ensure indices are within bounds
    const start = Math.max(0, startIndex);
    const end = Math.min(points.length - 1, endIndex);

    // Get the subset of points
    const subset = points.slice(start, end + 1);

    if (subset.length < 2) return { filteredPoints: subset, subsetStats: null };

    // FULL RECALCULATION for dynamic charts
    const calculated = calculateStats(subset);

    // Apply speed cap override for public view if needed
    if (!isOwner && speedCap && calculated.avgSpeed > speedCap) {
      calculated.avgSpeed = speedCap;
      // Recalculate time based on traveling at the capped speed
      // Time (seconds) = Distance (km) / Speed (km/h) * 3600
      calculated.totalTime = (calculated.totalDistance / speedCap) * 3600;
    }

    return {
      filteredPoints: subset,
      subsetStats: calculated
    };
  }, [points, profilePoints, zoomRange, speedCap, isOwner, stats]);


  // Calculate speed limited stats (for owner's speed limiter tool)
  const limitedStats = useMemo(() => {
    if (!showLimiter || speedLimit <= 0) return null;
    return calculateLimitedStats(filteredPoints, speedLimit);
  }, [filteredPoints, speedLimit, showLimiter]);

  const currentSectionStats = zoomRange && subsetStats ? subsetStats : stats;
  const limitedDisplayAvgSpeed = limitedStats && limitedStats.simulatedTime > 0
    ? currentSectionStats.totalDistance / (limitedStats.simulatedTime / 3600)
    : null;

  // displayStats: Clamp values if speed cap is active for public viewers
  const displayStats = useMemo(() => {
    if (!isOwner && speedCap && speedCap > 0) {
      return {
        maxSpeed: stats.maxSpeed > speedCap ? speedCap : stats.maxSpeed,
        avgSpeed: stats.avgSpeed > speedCap ? speedCap : stats.avgSpeed,
        movingAvgSpeed: stats.movingAvgSpeed > speedCap ? speedCap : stats.movingAvgSpeed,
        totalTime: stats.totalTime,
        movingTime: stats.movingTime,
      };
    }
    return {
      maxSpeed: stats.maxSpeed,
      avgSpeed: stats.avgSpeed,
      movingAvgSpeed: stats.movingAvgSpeed,
      totalTime: stats.totalTime,
      movingTime: stats.movingTime,
    };
  }, [stats, isOwner, speedCap]);

  // For public viewers: If selection avgSpeed > speedCap, cap it and recompute time
  // This is a simple overall cap, not per-segment
  const cappedSelectionStats = useMemo(() => {
    if (isOwner || !speedCap) return null;

    // Get the effective stats (zoomed selection or full)
    const effectiveStats = (zoomRange && subsetStats) ? subsetStats : stats;

    // Only apply cap if average speed exceeds speedCap
    if (effectiveStats.avgSpeed <= speedCap) return null;

    // Recompute time if we had traveled at speedCap average
    // Time (seconds) = Distance (km) / Speed (km/h) * 3600
    const simulatedTime = (effectiveStats.totalDistance / speedCap) * 3600;
    const timeAdded = simulatedTime - effectiveStats.totalTime;

    return {
      originalTime: effectiveStats.totalTime,
      originalAvgSpeed: effectiveStats.avgSpeed,
      cappedAvgSpeed: speedCap,
      simulatedTime,
      timeAdded,
    };
  }, [isOwner, speedCap, zoomRange, subsetStats, stats]);

  // Memoize TrackMap zoomRange to prevent new array reference on every render
  // Without this, every hover re-render creates [x, y] !== [x, y], triggering
  // TrackMap's heavy track-rendering useEffect (25k+ L.polyline calls)
  const adjustedMapZoomRange = useMemo(() => {
    if (!zoomRange) return null;
    const visibleEndIndex = mapPointsStartIndex + mapPoints.length - 1;
    if (mapPoints.length === 0 || zoomRange[1] < mapPointsStartIndex || zoomRange[0] > visibleEndIndex) {
      return null;
    }
    return [
      Math.max(zoomRange[0], mapPointsStartIndex) - mapPointsStartIndex,
      Math.min(zoomRange[1], visibleEndIndex) - mapPointsStartIndex,
    ] as [number, number];
  }, [zoomRange, mapPointsStartIndex, mapPoints.length]);

  // Effective speed limit for charts (owner's limiter or public speed cap)
  // Effective speed limit for charts
  // Effective speed limit for charts
  const effectiveChartSpeedLimit = useMemo(() => {
    // If the tool is enabled, show the line.
    if (showLimiter) return speedLimit;
    return null;
  }, [showLimiter, speedLimit]);

  // Precompute cumulative distance and time arrays for O(1) hover lookups
  // This replaces the O(n) haversine loop that ran on every mouse move
  const cumulativeData = useMemo(() => {
    const pointCount = profilePoints?.length ?? points.length;
    const cumDist = new Float64Array(pointCount);
    const cumTime = new Float64Array(pointCount);
    const speeds = new Float64Array(pointCount);
    if (profilePoints?.length) {
      for (let index = 0; index < profilePoints.length; index++) {
        cumDist[index] = profilePoints[index].distance;
        cumTime[index] = profilePoints[index].elapsedTime;
        speeds[index] = profilePoints[index].speed;
      }
      return { cumDist, cumTime, speeds };
    }
    cumDist[0] = 0;
    cumTime[0] = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const timeDiff = (curr.time && prev.time) ? (curr.time.getTime() - prev.time.getTime()) / 1000 : 0;
      if (timeDiff <= PAUSE_THRESHOLD) {
        const distance = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
        cumDist[i] = cumDist[i - 1] + distance;
        cumTime[i] = cumTime[i - 1] + timeDiff;
        speeds[i] = timeDiff > 0 ? Math.min(350, distance / (timeDiff / 3600)) : 0;
      } else {
        cumDist[i] = cumDist[i - 1];
        cumTime[i] = cumTime[i - 1];
        speeds[i] = 0;
      }
    }
    return { cumDist, cumTime, speeds };
  }, [points, profilePoints]);

  const updateReadout = useCallback((point: GPXPoint, speed: number | null, index: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastReadoutUpdateRef.current < READOUT_INTERVAL_MS) return;
    lastReadoutUpdateRef.current = now;
    setReadoutPoint(point);
    setReadoutSpeed(speed);
    setReadoutIndex(index);
  }, []);

  const privacySafeCursor = useCallback((point: GPXPoint, index: number) => {
    if (isOwner || mapPoints.length === 0) return { point, index: Math.round(index) };
    const safeStartIndex = mapPointsStartIndex;
    const safeEndIndex = mapPointsStartIndex + mapPoints.length - 1;
    if (index < safeStartIndex) return { point: mapPoints[0], index: -1 };
    if (index > safeEndIndex) return { point: mapPoints[mapPoints.length - 1], index: -1 };
    return { point, index: Math.round(index) };
  }, [isOwner, mapPoints, mapPointsStartIndex]);

  // Handle chart hover with privacy clamping (throttled via rAF)
  const handleHoverPoint = useCallback((point: GPXPoint | null, speed?: number, pointIndex?: number) => {
    // Cancel any pending hover update
    if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);

    if (!point) {
      // Clear immediately on leave
      lastReadoutUpdateRef.current = Number.NEGATIVE_INFINITY;
      setHoveredPoint(null);
      setReadoutPoint(null);
      setReadoutSpeed(null);
      setReadoutIndex(-1);
      return;
    }

    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
    setIsProfilePlaying(false);
    setPlaybackElapsedTime(null);

    // Throttle hover updates to rAF
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const idx = pointIndex ?? -1;
      if (idx >= 0) {
        playbackElapsedRef.current = cumulativeData.cumTime[idx];
      }
      if (!isOwner && mapPoints.length === 0) {
        lastReadoutUpdateRef.current = Number.NEGATIVE_INFINITY;
        setHoveredPoint(null);
        setReadoutPoint(null);
        setReadoutIndex(-1);
        return;
      }
      const safeCursor = privacySafeCursor(point, idx);
      setHoveredPoint(safeCursor.point);
      // Manual hover follows the animation frame so both the marker and its
      // readout stay fully responsive. Only autoplay uses the 5 fps throttle.
      updateReadout(safeCursor.point, speed ?? null, safeCursor.index, true);
    });
  }, [cumulativeData.cumTime, isOwner, mapPoints.length, privacySafeCursor, updateReadout]);

  useEffect(() => {
    const profileLength = profilePoints?.length ?? points.length;
    if (!isProfilePlaying || profileLength < 2) return;
    if (!isOwner && mapPoints.length === 0) {
      setIsProfilePlaying(false);
      return;
    }
    const maximum = cumulativeData.cumTime[cumulativeData.cumTime.length - 1] ?? 0;
    if (maximum <= 0) {
      setIsProfilePlaying(false);
      return;
    }

    let startElapsed = Math.min(playbackElapsedRef.current, maximum);
    if (startElapsed >= maximum) {
      startElapsed = 0;
      playbackElapsedRef.current = 0;
    }
    setPlaybackElapsedTime(startElapsed);
    lastPlaybackCursorUpdateRef.current = Number.NEGATIVE_INFINITY;
    const remaining = maximum - startElapsed;
    const remainingDuration = PROFILE_PLAYBACK_DURATION_MS * (remaining / maximum);
    const playbackFrameStep = maximum / (PROFILE_PLAYBACK_FPS * PROFILE_PLAYBACK_DURATION_MS / 1000);
    const startedAt = performance.now();

    const renderFrame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(1, remainingDuration));
      const elapsed = startElapsed + remaining * progress;
      let low = 1;
      let high = cumulativeData.cumTime.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (cumulativeData.cumTime[middle] < elapsed) low = middle + 1;
        else high = middle;
      }
      const right = low;
      const left = Math.max(0, right - 1);
      const timeSpan = cumulativeData.cumTime[right] - cumulativeData.cumTime[left];
      const ratio = timeSpan > 0 ? (elapsed - cumulativeData.cumTime[left]) / timeSpan : 1;
      const pointForProfileIndex = (index: number) => {
        if (!profilePoints?.length) return points[index];
        const coordinateIndex = Math.max(0, Math.min(points.length - 1, index - profilePointOffset));
        return points[coordinateIndex];
      };
      const leftPoint = pointForProfileIndex(left);
      const rightPoint = pointForProfileIndex(right);
      if (!leftPoint || !rightPoint) {
        playbackRafRef.current = null;
        setIsProfilePlaying(false);
        return;
      }
      const leftElevation = profilePoints?.[left]?.ele ?? leftPoint.ele;
      const rightElevation = profilePoints?.[right]?.ele ?? rightPoint.ele;
      const interpolatedPoint: GPXPoint = {
        ...rightPoint,
        lat: leftPoint.lat + (rightPoint.lat - leftPoint.lat) * ratio,
        lon: leftPoint.lon + (rightPoint.lon - leftPoint.lon) * ratio,
        ele: leftElevation != null && rightElevation != null
          ? leftElevation + (rightElevation - leftElevation) * ratio
          : rightElevation ?? leftElevation,
      };
      const safeCursor = privacySafeCursor(interpolatedPoint, left + ratio);
      let speed = frameAveragedSpeed(cumulativeData.cumTime, cumulativeData.speeds, elapsed, playbackFrameStep);
      if (!isOwner && speedCap) speed = Math.min(speed, speedCap);
      if (showLimiter) speed = Math.min(speed, speedLimit);

      playbackElapsedRef.current = elapsed;
      if (
        progress === 1 ||
        now - lastPlaybackCursorUpdateRef.current >= 1000 / PROFILE_CURSOR_FPS
      ) {
        lastPlaybackCursorUpdateRef.current = now;
        setPlaybackElapsedTime(elapsed);
      }
      setHoveredPoint(safeCursor.point);
      updateReadout(safeCursor.point, speed, safeCursor.index, progress === 1);

      if (progress === 1) {
        playbackRafRef.current = null;
        setIsProfilePlaying(false);
        return;
      }
      playbackRafRef.current = requestAnimationFrame(renderFrame);
    };

    playbackRafRef.current = requestAnimationFrame(renderFrame);
    return () => {
      if (playbackRafRef.current !== null) cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    };
  }, [cumulativeData, isOwner, isProfilePlaying, mapPoints.length, points, privacySafeCursor, profilePointOffset, profilePoints, showLimiter, speedCap, speedLimit, updateReadout]);

  const totalDistance = stats.totalDistance;
  const movingTime = stats.movingTime;

  // Calculate Fuel Efficiency
  const fuelEfficiency = fuel && fuel > 0 ? totalDistance / fuel : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <aside className="w-full lg:w-40 flex-shrink-0">
          <div className="sticky top-24 space-y-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all",
                    activeTab === tab.id
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                      : "bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Content Areas */}
        <main className="flex-1 space-y-8 min-w-0">

          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-background text-foreground p-3 border border-border">
                <div className="flex flex-col md:flex-row gap-6">

                  {/* LEFT SIDE: Avatar & Title (Mirroring Strava's Left Column) */}
                  <div className="flex-shrink-0 md:w-1/3 border-r border-border/50 pr-8">
                    <div className="flex gap-4 items-start">
                      <div className="w-24 h-24 rounded-full bg-muted overflow-hidden border border-border flex-shrink-0">
                        {ownerProfile?.avatar_url ? (
                          <img
                            src={ownerProfile.avatar_url}
                            alt={ownerProfile.display_name || ownerProfile.full_name || "User"}
                            className="w-full h-full object-cover"
                            crossOrigin="anonymous"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground font-bold">
                            {(ownerProfile?.display_name || ownerProfile?.full_name || "U").charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1 pt-1">
                        <div className="flex items-center gap-3">
                          <h1 className="text-2xl font-bold tracking-tight leading-tight">{fileName}</h1>
                        </div>

                        <div className="flex flex-col gap-0.5">
                          {(ownerProfile?.display_name || ownerProfile?.full_name) && (
                            <p className="text-sm font-medium text-foreground">
                              {ownerProfile.display_name || ownerProfile.full_name}
                              {ownerProfile.car && (
                                <span className="text-muted-foreground font-normal"> • {ownerProfile.car}</span>
                              )}
                            </p>
                          )}
                          {isOwner && (
                            <p className="text-xs text-muted-foreground leading-tight">
                              {new Date(stats.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} on {new Date(stats.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          )}
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5"><MapPin className="w-3 h-3" /> {stats.pointCount.toLocaleString()} points recorded</span>
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    {description && (
                      <p className="mt-4 text-sm text-muted-foreground line-clamp-3">
                        {description}
                      </p>
                    )}

                    {/* Speed cap info (owner only) */}
                    {isOwner && displaySpeedCap && (
                      <div className="mt-4 text-xs text-muted-foreground">
                        <Gauge className="w-3 h-3 inline mr-1" />
                        Speed cap set at {displaySpeedCap} km/h
                      </div>
                    )}




                  </div>

                  {/* RIGHT SIDE: Data Grid (The Strava Data Layout) */}
                  <div className="flex-1">
                    {/* 1. Hero Stats (Distance, Time, Elevation) */}
                    <div className="grid grid-cols-3 gap-y-6 gap-x-6 mb-4 items-end">
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatDistance(stats.totalDistance).replace(' km', '')}</span>
                          <span className="text-xl text-muted-foreground ml-1">km</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Distance</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{isMobile ? formatDurationShort(displayStats.totalTime) : formatDuration(displayStats.totalTime)}</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Elapsed Time</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatSpeed(displayStats.avgSpeed).replace(' km/h', '')}</span>
                          <span className="text-xl text-muted-foreground ml-1">km/h</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Average Speed</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatSpeed(displayStats.maxSpeed).replace(' km/h', '')}</span>
                          <span className="text-xl text-muted-foreground ml-1">km/h</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Top Speed</span>
                      </div>
                      <div>
                        <div className="text-2xl font-normal tabular-nums">{isMobile ? formatDurationShort(displayStats.movingTime) : formatDuration(displayStats.movingTime)}</div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Moving Time</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatSpeed(displayStats.movingAvgSpeed).replace(' km/h', '')}</span>
                          <span className="text-xl text-muted-foreground ml-1">km/h</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Average Moving Speed</span>
                      </div>
                      {fuel && fuel > 0 ? (
                        <>
                          <div>
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-normal tabular-nums">{fuel.toFixed(1)}</span>
                              <span className="text-xl text-muted-foreground ml-1">L</span>
                            </div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Fuel Used</span>
                          </div>
                          <div>
                            <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-normal tabular-nums">{fuelEfficiency.toFixed(1)}</span>
                              <span className="text-xl text-muted-foreground ml-1">km/L</span>
                            </div>
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Efficiency</span>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Map Section */}
              <div className="bg-card border border-border rounded-2xl p-3 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-lg font-semibold text-foreground">Route Map</h3>
                  <InfoPopover contentClassName="space-y-2 z-[1100]">
                    <p>
                      <strong>Visualization:</strong> The path is colored by speed. Markers indicate stops and sharp turns.
                    </p>
                    <div className="border-t border-border/50 pt-2">
                      {isOwner ? (
                        <p className="text-muted-foreground">
                          <strong>Privacy Zone:</strong> A {hideRadius}km radius around the start/end is visible to you, but hidden from public links.
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          <strong>Privacy Zone:</strong> The first/last few kilometers of this drive are hidden to protect the owner's privacy.
                        </p>
                      )}
                    </div>
                  </InfoPopover>
                </div>
                <TrackMap
                  points={mapPoints}
                  hoveredPoint={hoveredPoint}
                  zoomRange={adjustedMapZoomRange}
                  stopPoints={stats.stopPoints}
                  tightTurnPoints={stats.tightTurnPoints}
                  hairpinPoints={stats.hairpinPoints}
                  privacyMask={privacyMask}
                />
              </div>

              {/* Speed & Elevation Chart */}
              <div className="bg-card border border-border rounded-2xl p-3 shadow-sm">
                {/* Compact Header & Stats Row */}
                <div className="flex flex-col gap-3 mb-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Left: Title */}
                    <div className="flex-shrink-0">
                      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        Speed & Elevation Timeline
                        <InfoPopover contentClassName="z-[1100]">
                          <p>Interactive timeline showing speed (upper chart) and elevation (lower chart). Select speed/elevation chart to zoom, drag and interact. Use speed limiter to understand how longer your drive takes if you stick to a speed limit.</p>
                        </InfoPopover>
                      </h3>
                    </div>

                    {/* Middle: Slider (Centered & Flex-grow) - Mobile optimized */}
                    {showLimiter && (
                      <div className="w-full md:flex-1 md:max-w-[350px] px-2 animate-in fade-in zoom-in-95 duration-200 order-3 md:order-2 mt-4 md:mt-0">
                        <Slider
                          min={40}
                          max={speedCap ? Math.min(speedCap - 10, 200) : Math.max(Math.ceil(stats.maxSpeed / 10) * 10, 120)}
                          step={10}
                          value={[speedLimit]}
                          onValueChange={([val]) => setSpeedLimit(val)}
                          className="w-full relative py-2 cursor-grab active:cursor-grabbing"
                          thumbClassName="h-6 w-6 md:h-4 md:w-4 rounded-full border-2 border-primary bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                          thumbChildren={
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs font-bold px-2 py-0.5 rounded shadow-md border whitespace-nowrap">
                              {speedLimit} km/h
                            </div>
                          }
                        />
                      </div>
                    )}

                    {/* Right: Controls (Toggle + Reset) */}
                    <div className="flex items-center gap-3 flex-shrink-0 order-2 md:order-3">
                      <button
                        type="button"
                        onClick={() => {
                          setXAxisMode('time');
                          if (!isProfilePlaying) setZoomRange(null);
                          setIsProfilePlaying((playing) => !playing);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={isProfilePlaying ? "Pause drive profile" : "Play drive profile"}
                        title={isProfilePlaying ? "Pause drive profile" : "Play drive profile"}
                      >
                        {isProfilePlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>

                      {/* Distance/Time Toggle */}
                      <div className="flex items-center gap-2 bg-muted/50 px-2.5 py-1 rounded-full border border-border/50">
                        <button
                          onClick={() => {
                            setIsProfilePlaying(false);
                            setXAxisMode('distance');
                          }}
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 rounded-md transition-colors",
                            xAxisMode === 'distance' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Distance
                        </button>
                        <button
                          onClick={() => setXAxisMode('time')}
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 rounded-md transition-colors",
                            xAxisMode === 'time' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Time
                        </button>
                      </div>

                      {/* Speed Limiter Toggle */}
                      <div className="flex items-center gap-2 bg-muted/50 px-2.5 py-1 rounded-full border border-border/50">
                        <Switch
                          id="speed-limiter"
                          checked={showLimiter}
                          onCheckedChange={setShowLimiter}
                          className="data-[state=checked]:bg-[#CC785C]"
                        />
                        <Label htmlFor="speed-limiter" className="text-xs font-semibold cursor-pointer">Speed Limiter</Label>
                      </div>

                      {zoomRange && (
                        <button
                          className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-md hover:bg-primary/20 transition-colors"
                          onClick={() => setZoomRange(null)}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset View
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Single Line Uniform Stats Row */}
                  <div className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
                    <div className="flex items-center gap-8">
                      {/* Distance - Simple Inline */}
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-normal tabular-nums">{zoomRange && subsetStats ? formatDistance(subsetStats.totalDistance) : formatDistance(stats.totalDistance)}</span>
                      </div>

                      {/* Time - Inline with Arrow Delta */}
                      <div className="flex items-baseline gap-2">
                        {/* Determine if we need to show modified stats */}
                        {(() => {
                          // Owner's speed limiter
                          if (showLimiter && limitedStats && limitedStats.timeAdded > 0) {
                            if (isMobile) {
                              // Mobile: Two-line stacked
                              return (
                                <div className="flex flex-col gap-0.5 animate-in fade-in slide-in-from-left-2">
                                  <span className="text-xs font-normal tabular-nums text-muted-foreground/50 line-through">
                                    {zoomRange && subsetStats ? formatDurationShort(subsetStats.totalTime) : formatDurationShort(stats.totalTime)}
                                  </span>
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-sm font-normal text-[#CC785C] tabular-nums">
                                      {formatDurationShort(limitedStats.simulatedTime)}
                                    </span>
                                    <span className="text-xs text-[#CC785C] tabular-nums">
                                      (+{formatDurationShort(limitedStats.timeAdded)})
                                    </span>
                                    <span className="text-[10px] font-semibold text-[#CC785C]">
                                      {((limitedStats.timeAdded / (zoomRange && subsetStats ? subsetStats.totalTime : stats.totalTime)) * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                </div>
                              );
                            }
                            // Desktop: Inline (Original behavior restored)
                            return (
                              <div className="flex items-baseline gap-2 animate-in fade-in slide-in-from-left-2">
                                <span className="text-lg font-normal tabular-nums text-muted-foreground/50 line-through">
                                  {zoomRange && subsetStats ? formatDuration(subsetStats.totalTime) : formatDuration(stats.totalTime)}
                                </span>
                                <span className="text-lg font-normal text-[#CC785C] tabular-nums">
                                  {formatDuration(limitedStats.simulatedTime)}
                                </span>
                                <span className="text-sm text-[#CC785C] tabular-nums">
                                  (+{formatDuration(limitedStats.timeAdded)})
                                </span>
                                <span className="text-xs font-semibold text-[#CC785C]">
                                  {((limitedStats.timeAdded / (zoomRange && subsetStats ? subsetStats.totalTime : stats.totalTime)) * 100).toFixed(0)}% slower
                                </span>
                              </div>
                            );
                          }

                          // Public viewer's speed cap (only if avgSpeed > speedCap)
                          if (cappedSelectionStats) {
                            return (
                              <div className="flex items-baseline gap-1.5 animate-in fade-in slide-in-from-left-2">
                                <span className="text-lg font-normal text-blue-500 tabular-nums">
                                  {formatDuration(cappedSelectionStats.simulatedTime)}
                                </span>
                                <span className="flex items-center text-xs font-bold text-blue-500/90 gap-0.5">
                                  <TrendingUp className="w-3 h-3" />
                                  +{formatDuration(cappedSelectionStats.timeAdded)}
                                </span>
                              </div>
                            );
                          }

                          // Default: show actual time
                          return (
                            <span className="text-lg font-normal tabular-nums text-foreground">
                              {zoomRange && subsetStats ? formatDuration(subsetStats.totalTime) : formatDuration(stats.totalTime)}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Speed - Inline with Arrow Delta */}
                      <div className="flex items-baseline gap-2">
                        {(() => {
                          // Owner's speed limiter
                          if (showLimiter && limitedStats && limitedDisplayAvgSpeed !== null && limitedStats.timeAdded > 0) {
                            if (isMobile) {
                              // Mobile: Two-line stacked
                              return (
                                <div className="flex flex-col gap-0.5 animate-in fade-in slide-in-from-left-2">
                                  <span className="text-xs font-normal tabular-nums text-muted-foreground/50 line-through">
                                    {formatSpeed(currentSectionStats.avgSpeed)}
                                  </span>
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-sm font-normal text-[#CC785C] tabular-nums">
                                      {formatSpeed(limitedDisplayAvgSpeed)}
                                    </span>
                                    <span className="text-xs text-[#CC785C] tabular-nums">
                                      (-{formatSpeed(currentSectionStats.avgSpeed - limitedDisplayAvgSpeed)})
                                    </span>
                                  </div>
                                </div>
                              );
                            }
                            // Desktop: Inline (Original behavior)
                            return (
                              <div className="flex items-baseline gap-2 animate-in fade-in slide-in-from-left-2">
                                <span className="text-lg font-normal tabular-nums text-muted-foreground/50 line-through">
                                  {formatSpeed(currentSectionStats.avgSpeed)}
                                </span>
                                <span className="text-lg font-normal text-[#CC785C] tabular-nums">
                                  {formatSpeed(limitedDisplayAvgSpeed)}
                                </span>
                                <span className="text-sm text-[#CC785C] tabular-nums">
                                  (-{formatSpeed(currentSectionStats.avgSpeed - limitedDisplayAvgSpeed)})
                                </span>
                              </div>
                            );
                          }
                          // Public viewer's speed cap (only if avgSpeed > speedCap)
                          if (cappedSelectionStats) {
                            return (
                              <>
                                <span className="text-lg font-normal tabular-nums text-muted-foreground/50 line-through">
                                  {formatSpeed(cappedSelectionStats.originalAvgSpeed)}
                                </span>
                                <div className="flex items-baseline gap-1.5 animate-in fade-in slide-in-from-left-2">
                                  <span className="text-lg font-normal text-blue-500 tabular-nums">
                                    {formatSpeed(cappedSelectionStats.cappedAvgSpeed)}
                                  </span>
                                  <span className="flex items-center text-xs font-bold text-blue-500/90">
                                    <TrendingUp className="w-3 h-3 rotate-180 mr-0.5" />
                                    -{formatSpeed(cappedSelectionStats.originalAvgSpeed - cappedSelectionStats.cappedAvgSpeed)}
                                  </span>
                                </div>
                              </>
                            );
                          }
                          // Default: show actual speed
                          return (
                            <span className="text-lg font-normal tabular-nums text-foreground">
                              {zoomRange && subsetStats ? formatSpeed(subsetStats.avgSpeed) : formatSpeed(stats.avgSpeed)}
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Hover Data Display - Desktop: inline on same row */}
                    {!isMobile && readoutPoint && (() => {
                      const cd = readoutIndex >= 0 ? cumulativeData.cumDist[readoutIndex] : 0;
                      const ct = readoutIndex >= 0 ? cumulativeData.cumTime[readoutIndex] : 0;
                      const finalDisplaySpeed = readoutSpeed ?? 0;
                      const h = Math.floor(ct / 3600);
                      const m = Math.floor((ct % 3600) / 60);
                      const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

                      return (
                        <div className="flex items-baseline gap-2 animate-in fade-in duration-150">
                          <span className="text-lg font-normal tabular-nums">{timeStr}</span>
                          <span className="text-muted-foreground">|</span>
                          <span className="text-lg font-normal tabular-nums">{formatDistance(cd)}</span>
                          <span className="text-muted-foreground">|</span>
                          <span className="text-lg font-normal tabular-nums">{formatSpeed(finalDisplaySpeed)}</span>
                          {readoutPoint.ele !== undefined && (
                            <>
                              <span className="text-muted-foreground">|</span>
                              <span className="text-lg font-normal tabular-nums">{readoutPoint.ele.toFixed(0)}m</span>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Hover Data Display - Mobile: own row below */}
                {isMobile && readoutPoint && (() => {
                  const cd = readoutIndex >= 0 ? cumulativeData.cumDist[readoutIndex] : 0;
                  const ct = readoutIndex >= 0 ? cumulativeData.cumTime[readoutIndex] : 0;
                  const finalDisplaySpeed = readoutSpeed ?? 0;
                  const h = Math.floor(ct / 3600);
                  const m = Math.floor((ct % 3600) / 60);
                  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

                  return (
                    <div className="flex items-center gap-4 bg-muted/30 rounded-lg px-3 py-2 border border-border/50 animate-in fade-in duration-150">
                      <span className="text-sm font-mono font-semibold tabular-nums">{timeStr}</span>
                      <span className="text-sm font-mono font-semibold tabular-nums">{formatDistance(cd)}</span>
                      <span className="text-sm font-mono font-semibold tabular-nums">{formatSpeed(finalDisplaySpeed)}</span>
                      {readoutPoint.ele !== undefined && (
                        <span className="text-sm font-mono font-semibold tabular-nums">{readoutPoint.ele.toFixed(0)}m</span>
                      )}
                    </div>
                  );
                })()}

                <div className="relative h-[300px] w-full cursor-crosshair">
                  <SpeedElevationChart
                    points={points}
                    profilePoints={profilePoints}
                    profilePointOffset={profilePointOffset}
                    onHover={handleHoverPoint}
                    onZoomChange={setZoomRange}
                    zoomRange={zoomRange}
                    speedLimit={effectiveChartSpeedLimit}
                    speedCap={!isOwner ? speedCap : null}
                    visualLimit={showLimiter ? speedLimit : undefined}
                    xAxisMode={xAxisMode}
                    maxSpeed={stats.maxSpeed}
                    playbackElapsedTime={playbackElapsedTime}
                  />
                </div>
              </div>

              {/* Speed Distribution (Moved to Overview) */}
              <div className="bg-card border border-border rounded-2xl p-3 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Speed Distribution
                    {zoomRange && <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Filtered to selection</span>}
                    {effectiveChartSpeedLimit && <span className="text-xs font-normal text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">Capped at {effectiveChartSpeedLimit} km/h</span>}
                    <InfoPopover>
                      <p>Histogram showing how much time/distance was spent at each speed range.</p>
                    </InfoPopover>
                  </h3>
                </div>
                <div className="h-[250px]">
                  <SpeedDistributionChart
                    points={filteredPoints}
                    speedLimit={!isOwner ? (effectiveChartSpeedLimit ?? speedCap) : effectiveChartSpeedLimit}
                  />
                </div>
              </div>
              {/* Motion Time Profile (Moved to Overview) */}
              {/* Uses effective stats (subset if zoomed, full if not) */}
              <div className="bg-card border border-border rounded-2xl p-3 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-primary" />
                  Motion Time Profile
                  {zoomRange && <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Filtered to selection</span>}
                </h3>

                {/* Full Horizontal Thin Profile */}
                <div className="space-y-4">
                  {(() => {
                    const effectiveStats = (zoomRange && subsetStats) ? subsetStats : stats;
                    const total = effectiveStats.totalTime || 1;

                    return (
                      <>
                        <div className="h-3 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
                          {[
                            { seconds: effectiveStats.timeAccelerating, color: "bg-emerald-500" },
                            { seconds: effectiveStats.timeCruising, color: "bg-foreground" }, // Black (Cruise)
                            { seconds: effectiveStats.timeBraking, color: "bg-red-500" },
                            { seconds: effectiveStats.stoppedTime, color: "bg-muted-foreground/30" },
                          ].map((item, idx) => {
                            const width = (item.seconds / total) * 100;
                            if (width <= 0) return null;
                            return (
                              <div
                                key={idx}
                                className={cn("h-full transition-all duration-500", item.color)}
                                style={{ width: `${width}%` }}
                              />
                            );
                          })}
                        </div>

                        {/* Legend for Profile (Horizontal) */}
                        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                          {[
                            { label: "Accel", seconds: effectiveStats.timeAccelerating, color: "bg-emerald-500" },
                            { label: "Cruise", seconds: effectiveStats.timeCruising, color: "bg-foreground" },
                            { label: "Brake", seconds: effectiveStats.timeBraking, color: "bg-red-500" },
                            { label: "Stop", seconds: effectiveStats.stoppedTime, color: "bg-muted-foreground/30" },
                          ].map(item => (
                            <div key={item.label} className="flex items-center gap-2">
                              <div className={cn("w-2 h-2 rounded-full", item.color)} />
                              <span className="font-medium text-muted-foreground">{item.label} ({((item.seconds / total) * 100).toFixed(0)}%):</span>
                              <span className="font-mono tabular-nums text-foreground">{formatDuration(item.seconds)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}


          {/* ROUTE STRUCTURE TAB (Consolidated & Refined) */}
          {activeTab === "structure" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

              {segmentRanks.length > 0 && (
                <div>
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Trophy className="w-6 h-6 text-amber-500" />
                    Segments
                  </h3>
                  <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
                    <div className="min-w-[760px]">
                      {segmentRanks.map((segment, index) => (
                        <Link
                          key={segment.segmentId}
                          to={`/segments/${segment.segmentId}`}
                          className={cn(
                            "grid grid-cols-[7rem_minmax(12rem,1fr)_8rem_7rem_8rem_9rem] items-center gap-4 whitespace-nowrap px-4 py-3 transition-colors hover:bg-accent",
                            index > 0 && "border-t border-border"
                          )}
                        >
                          <span className="text-lg font-black tabular-nums text-muted-foreground">
                            {segment.rank}/{segment.totalRides} <span className="text-xs font-semibold">drives</span>
                          </span>
                          <span className="truncate font-semibold text-foreground hover:text-primary">
                            {segment.segmentName}
                          </span>
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">
                            {(segment.coverage * 100).toFixed(0)}% coverage
                          </span>
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">
                            {segment.matchedDistance.toFixed(1)} km
                          </span>
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">
                            {formatDuration(segment.elapsedTime)}
                          </span>
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">
                            {segment.avgSpeed.toFixed(1)} km/h
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {fastestDistanceEfforts.length > 0 && (
                <div>
                  <h3 className="text-base font-semibold mb-1 flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-primary" />
                    Your Fastest Consecutive Distances
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Quickest continuous window for each distance completed by this ride.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                    {fastestDistanceEfforts.map((effort) => (
                      <div key={effort.distanceKm} className="bg-card border border-border rounded-lg px-3 py-2.5 shadow-sm min-w-0">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                          {effort.distanceKm} km
                        </span>
                        <span className="block text-base font-semibold tabular-nums mt-1 leading-tight">
                          {formatDuration(effort.elapsedTime)}
                        </span>
                        <span className="block text-xs text-primary tabular-nums mt-0.5 whitespace-nowrap [text-shadow:0_1px_1px_rgba(0,0,0,0.14)]">
                          {formatSpeed(effort.averageSpeed)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 1: ALL METRICS (Consolidated) */}
              <div>
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <Spline className="w-6 h-6 text-primary" />
                  Route Metrics
                </h3>

                <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-y-6 gap-x-8">

                    {/* Geometry Group */}
                    <div>
                      <span className="block text-2xl font-normal text-foreground">{Math.round(stats.totalHeadingChange).toLocaleString()}°</span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Rotation</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground">{stats.twistinessScore.toFixed(0)}°/km</span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Twistiness</span>
                    </div>
                    {/* Terrain Group */}
                    <div>
                      <span className="block text-2xl font-normal text-foreground leading-none">+{stats.elevationGain.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Uphill</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground leading-none">-{stats.elevationLoss.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Downhill</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground leading-none">{stats.hillinessScore.toFixed(1)}</span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Hilliness</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground leading-none">{stats.elevationGain - stats.elevationLoss > 0 ? "+" : ""}{(stats.elevationGain - stats.elevationLoss).toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Elevation Gain</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground leading-none">{stats.maxElevation.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Highest Point</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground leading-none">{stats.minElevation.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Lowest Point</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: PROFILES (Geometry + Terrain) */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-stretch">
                {/* Straight vs Curvy Profile */}
                <div className="h-full bg-card border border-border rounded-2xl p-4 shadow-sm">
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Spline className="w-5 h-5 text-primary" />
                    Geometry Profile
                  </h3>
                  <div className="space-y-3">
                    {/* Visual Stacked Bar */}
                    <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
                      {[
                        { dist: stats.totalDistance * (stats.percentStraight / 100), color: "bg-primary" },
                        { dist: stats.totalDistance * ((100 - stats.percentStraight) / 100), color: "bg-foreground/80" }, // Curves -> Dark/Blackish
                      ].map((item, idx) => {
                        const width = (item.dist / (stats.totalDistance || 1)) * 100;
                        if (width <= 0) return null;
                        return (
                          <div
                            key={idx}
                            className={cn("h-full transition-all duration-1000", item.color)}
                            style={{ width: `${width}%` }}
                          />
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-8 overflow-x-auto whitespace-nowrap text-sm">
                      {[
                        { label: "Straights", dist: stats.totalDistance * (stats.percentStraight / 100), color: "bg-primary" },
                        { label: "Curves", dist: stats.totalDistance * ((100 - stats.percentStraight) / 100), color: "bg-foreground/80" },
                      ].map((item) => {
                        const percentage = (item.dist / (stats.totalDistance || 1)) * 100;
                        return (
                          <div key={item.label} className="flex items-center gap-2 whitespace-nowrap">
                            <span className={cn("h-2.5 w-2.5 rounded-full", item.color)} />
                            <span className="font-bold">{item.label}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">{formatDistance(item.dist)} ({percentage.toFixed(1)}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Terrain Profile */}
                <div className="h-full bg-card border border-border rounded-2xl p-4 shadow-sm">
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Terrain Profile
                  </h3>
                  <div className="space-y-3">
                    {/* Visual Stacked Bar */}
                    <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
                      {[
                        { distance: terrainDistances.uphill, color: "bg-primary" },
                        { distance: terrainDistances.downhill, color: "bg-foreground/80" },
                        { distance: terrainDistances.flat, color: "bg-muted-foreground/30" },
                      ].map((item, idx) => {
                        const width = (item.distance / (stats.totalDistance || 1)) * 100;
                        if (width <= 0) return null;
                        return (
                          <div
                            key={idx}
                            className={cn("h-full transition-all duration-1000", item.color)}
                            style={{ width: `${width}%` }}
                          />
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-6 overflow-x-auto whitespace-nowrap text-sm">
                      {[
                        { label: "Uphill", distance: terrainDistances.uphill, color: "bg-primary" },
                        { label: "Downhill", distance: terrainDistances.downhill, color: "bg-foreground/80" },
                        { label: "Flat", distance: terrainDistances.flat, color: "bg-muted-foreground/30" },
                      ].map((item) => {
                        const percentage = (item.distance / (stats.totalDistance || 1)) * 100;
                        return (
                          <div key={item.label} className="flex items-center gap-2 whitespace-nowrap">
                            <span className={cn("h-2.5 w-2.5 rounded-full", item.color)} />
                            <span className="font-bold">{item.label}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">{formatDistance(item.distance)} ({percentage.toFixed(1)}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

        </main >
      </div >
    </div >
  );
};

export default GPSStats;
