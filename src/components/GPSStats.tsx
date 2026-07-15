import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
  Pencil
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
  speedCap?: number | null;
  displaySpeedCap?: number | null;
  isOwner?: boolean;
  isPublic?: boolean;
  description?: string | null;
  hideRadius?: number;
  ownerProfile?: OwnerProfile | null;
  onEdit?: () => void;
  fuel?: number | null;
}

const GPSStats = ({ stats: initialStats, fileName, points: initialPoints, speedCap, displaySpeedCap, isOwner = true, isPublic = false, description, hideRadius = 0, ownerProfile, onEdit, fuel }: GPSStatsProps) => {
  const [hoveredPoint, setHoveredPoint] = useState<GPXPoint | null>(null);
  const [hoveredSpeed, setHoveredSpeed] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const hoverRafRef = useRef<number | null>(null);

  // Cleanup hover rAF on unmount
  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
    };
  }, []);

  // Filter points based on privacy radius
  const { points, stats, privacyMask, mapPoints, mapPointsStartIndex } = useMemo(() => {
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
  }, [initialPoints, initialStats, hideRadius, isOwner]);

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

  // Calculate stats for the selected zoom range
  const { filteredPoints, subsetStats } = useMemo(() => {
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
  }, [points, zoomRange, speedCap, isOwner]);


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
    return [zoomRange[0] - mapPointsStartIndex, zoomRange[1] - mapPointsStartIndex] as [number, number];
  }, [zoomRange, mapPointsStartIndex]);

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
    const cumDist = new Float64Array(points.length);
    const cumTime = new Float64Array(points.length);
    cumDist[0] = 0;
    cumTime[0] = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const timeDiff = (curr.time && prev.time) ? (curr.time.getTime() - prev.time.getTime()) / 1000 : 0;
      if (timeDiff <= PAUSE_THRESHOLD) {
        cumDist[i] = cumDist[i - 1] + haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
        cumTime[i] = cumTime[i - 1] + timeDiff;
      } else {
        cumDist[i] = cumDist[i - 1];
        cumTime[i] = cumTime[i - 1];
      }
    }
    return { cumDist, cumTime };
  }, [points]);

  // Handle chart hover with privacy clamping (throttled via rAF)
  const handleHoverPoint = useCallback((point: GPXPoint | null, speed?: number, pointIndex?: number) => {
    // Cancel any pending hover update
    if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);

    if (!point) {
      // Clear immediately on leave
      setHoveredPoint(null);
      setHoveredSpeed(null);
      setHoveredIndex(-1);
      return;
    }

    // Throttle hover updates to rAF
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const idx = pointIndex ?? -1;

      if (isOwner) {
        setHoveredPoint(point);
        setHoveredSpeed(speed ?? null);
        setHoveredIndex(idx);
        return;
      }

      // Privacy Logic for Public Viewers
      if (!mapPoints || mapPoints.length === 0) {
        setHoveredPoint(null);
        setHoveredIndex(-1);
        return;
      }

      const safeStart = mapPoints[0];
      const safeEnd = mapPoints[mapPoints.length - 1];

      if (!point.time || !safeStart.time || !safeEnd.time) {
        setHoveredPoint(point);
        setHoveredIndex(idx);
        return;
      }

      const pTime = point.time.getTime();
      const startTime = safeStart.time.getTime();
      const endTime = safeEnd.time.getTime();

      if (pTime < startTime) {
        setHoveredPoint(safeStart);
        setHoveredIndex(-1);
      } else if (pTime > endTime) {
        setHoveredPoint(safeEnd);
        setHoveredIndex(-1);
      } else {
        setHoveredPoint(point);
        setHoveredSpeed(speed ?? null);
        setHoveredIndex(idx);
      }
    });
  }, [isOwner, mapPoints]);

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
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="focus:outline-none" aria-label="More Information">
                        <Info className="w-4 h-4 text-muted-foreground hover:text-foreground cursor-help" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-xs text-xs space-y-2 z-[1100]">
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
                    </PopoverContent>
                  </Popover>
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
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className="focus:outline-none" aria-label="More Information">
                              <Info className="w-4 h-4 text-muted-foreground hover:text-foreground cursor-help" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="max-w-xs text-xs z-[1100]">
                            <p>Interactive timeline showing speed (upper chart) and elevation (lower chart). Select speed/elevation chart to zoom, drag and interact. Use speed limiter to understand how longer your drive takes if you stick to a speed limit.</p>
                          </PopoverContent>
                        </Popover>
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
                      {/* Distance/Time Toggle */}
                      <div className="flex items-center gap-2 bg-muted/50 px-2.5 py-1 rounded-full border border-border/50">
                        <button
                          onClick={() => setXAxisMode('distance')}
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
                    {!isMobile && hoveredPoint && (() => {
                      const cd = hoveredIndex >= 0 ? cumulativeData.cumDist[hoveredIndex] : 0;
                      const ct = hoveredIndex >= 0 ? cumulativeData.cumTime[hoveredIndex] : 0;
                      const finalDisplaySpeed = hoveredSpeed ?? 0;
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
                          {hoveredPoint.ele !== undefined && (
                            <>
                              <span className="text-muted-foreground">|</span>
                              <span className="text-lg font-normal tabular-nums">{hoveredPoint.ele.toFixed(0)}m</span>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Hover Data Display - Mobile: own row below */}
                {isMobile && hoveredPoint && (() => {
                  const cd = hoveredIndex >= 0 ? cumulativeData.cumDist[hoveredIndex] : 0;
                  const ct = hoveredIndex >= 0 ? cumulativeData.cumTime[hoveredIndex] : 0;
                  const finalDisplaySpeed = hoveredSpeed ?? 0;
                  const h = Math.floor(ct / 3600);
                  const m = Math.floor((ct % 3600) / 60);
                  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

                  return (
                    <div className="flex items-center gap-4 bg-muted/30 rounded-lg px-3 py-2 border border-border/50 animate-in fade-in duration-150">
                      <span className="text-sm font-mono font-semibold tabular-nums">{timeStr}</span>
                      <span className="text-sm font-mono font-semibold tabular-nums">{formatDistance(cd)}</span>
                      <span className="text-sm font-mono font-semibold tabular-nums">{formatSpeed(finalDisplaySpeed)}</span>
                      {hoveredPoint.ele !== undefined && (
                        <span className="text-sm font-mono font-semibold tabular-nums">{hoveredPoint.ele.toFixed(0)}m</span>
                      )}
                    </div>
                  );
                })()}

                <div className="relative h-[300px] w-full cursor-crosshair">
                  <SpeedElevationChart
                    points={points}
                    onHover={handleHoverPoint}
                    onZoomChange={setZoomRange}
                    zoomRange={zoomRange}
                    speedLimit={effectiveChartSpeedLimit}
                    speedCap={!isOwner ? speedCap : null}
                    visualLimit={showLimiter ? speedLimit : undefined}
                    xAxisMode={xAxisMode}
                    maxSpeed={stats.maxSpeed}
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="focus:outline-none" aria-label="More Information">
                          <Info className="w-4 h-4 text-muted-foreground hover:text-foreground cursor-help" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-xs text-xs">
                        <p>Histogram showing how much time/distance was spent at each speed range.</p>
                      </PopoverContent>
                    </Popover>
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

              {fastestDistanceEfforts.length > 0 && (
                <div>
                  <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
                    <Gauge className="w-6 h-6 text-primary" />
                    Fastest Consecutive Distance
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Quickest continuous window for each distance completed by this ride.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {fastestDistanceEfforts.map((effort) => (
                      <div key={effort.distanceKm} className="bg-card border border-border rounded-xl p-4 shadow-sm">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Fastest {effort.distanceKm} km
                        </span>
                        <span className="block text-xl font-semibold tabular-nums mt-2">
                          {formatDuration(effort.elapsedTime)}
                        </span>
                        <span className="block text-sm text-primary tabular-nums mt-1">
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
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Straight vs Curvy Profile */}
                <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Spline className="w-5 h-5 text-primary" />
                    Geometry Profile
                  </h3>
                  <div className="space-y-6">
                    {/* Visual Stacked Bar */}
                    <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
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

                    <div className="space-y-4">
                      {[
                        { label: "Straight Sections", dist: stats.totalDistance * (stats.percentStraight / 100), color: "bg-primary", desc: "Sustained heading" },
                        { label: "Corners & Curves", dist: stats.totalDistance * ((100 - stats.percentStraight) / 100), color: "bg-foreground/80", desc: "Frequent turns" },
                      ].map((item, idx) => {
                        const percentage = (item.dist / (stats.totalDistance || 1)) * 100;
                        return (
                          <div key={item.label} className="flex items-center gap-4">
                            <div className={cn("w-1 h-8 rounded-full", item.color)} />
                            <div className="flex-1">
                              <div className="flex justify-between text-sm mb-1">
                                <span className="font-bold">{item.label}</span>
                                <span className="font-mono text-muted-foreground">{formatDistance(item.dist)}</span>
                              </div>
                              <div className="flex justify-between items-end">
                                <span className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">{item.desc}</span>
                                <span className="text-xs font-bold text-foreground">{percentage.toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Terrain Profile */}
                <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Terrain Time Profile
                  </h3>
                  <div className="space-y-6">
                    {/* Visual Stacked Bar */}
                    <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
                      {[
                        { seconds: stats.timeClimbing, color: "bg-primary" },
                        { seconds: stats.timeDescending, color: "bg-foreground/80" },
                        { seconds: stats.timeLevel, color: "bg-muted-foreground/30" },
                      ].map((item, idx) => {
                        const width = (item.seconds / (stats.totalTime || 1)) * 100;
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

                    <div className="space-y-4">
                      {[
                        { label: "Climbing", seconds: stats.timeClimbing, color: "bg-primary", desc: "Uphill battle" },
                        { label: "Descending", seconds: stats.timeDescending, color: "bg-foreground/80", desc: "Gravity assisted" },
                        { label: "Level Flight", seconds: stats.timeLevel, color: "bg-muted-foreground/30", desc: "Flat terrain" },
                      ].map((item, idx) => {
                        const percentage = (item.seconds / (stats.totalTime || 1)) * 100;
                        return (
                          <div key={item.label} className="flex items-center gap-4">
                            <div className={cn("w-1 h-8 rounded-full", item.color)} />
                            <div className="flex-1">
                              <div className="flex justify-between text-sm mb-1">
                                <span className="font-bold">{item.label}</span>
                                <span className="font-mono text-muted-foreground">{formatDuration(item.seconds)}</span>
                              </div>
                              <div className="flex justify-between items-end">
                                <span className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">{item.desc}</span>
                                <span className="text-xs font-bold text-foreground">{percentage.toFixed(1)}%</span>
                              </div>
                            </div>
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
