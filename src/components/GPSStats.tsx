import { useState, useMemo } from "react";
import { MapPin, Activity, TrendingUp, Compass, RotateCcw, MoveRight, GitCommit, Spline, Gauge, Clock, AlertTriangle, Globe, Lock } from "lucide-react";
import { ResponsiveContainer } from "recharts";
import TrackMap from "./TrackMap";
import SpeedElevationChart from "./SpeedElevationChart";
import SpeedDistributionChart from "./SpeedDistributionChart";
import ChartRangeSlider from "./ChartRangeSlider";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  GPXStats,
  GPXPoint,
  formatDistance,
  formatDuration,
  formatSpeed,
  haversineDistance,
  calculateLimitedStats,
  calculateStats
} from "@/utils/gpxParser";

interface GPSStatsProps {
  stats: GPXStats;
  fileName: string;
  points: GPXPoint[];
  speedCap?: number | null;
  isOwner?: boolean;
  isPublic?: boolean;
  description?: string | null;
  hideRadius?: number; // km
}

const GPSStats = ({ stats: initialStats, fileName, points: initialPoints, speedCap, isOwner = true, isPublic = false, description, hideRadius = 0 }: GPSStatsProps) => {
  const [hoveredPoint, setHoveredPoint] = useState<GPXPoint | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  // Filter points based on privacy radius
  const { points, stats, privacyMask, mapPoints } = useMemo(() => {
    if ((!hideRadius || hideRadius <= 0) && isOwner) {
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: null,
        mapPoints: initialPoints
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
      if (!isOwner) return { points: initialPoints, stats: initialStats, privacyMask: null, mapPoints: [] };
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: { start: startIndex, end: endIndex },
        mapPoints: initialPoints
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
        mapPoints: slicedPoints
      };
    } else {
      // Owner: Keep all points, but pass mask indices
      return {
        points: initialPoints,
        stats: initialStats,
        privacyMask: { start: startIndex, end: endIndex },
        mapPoints: initialPoints
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

  const tabs = [
    { id: "overview", label: "Overview", icon: MapPin },
    { id: "motion", label: "Motion & Physics", icon: Activity },
    { id: "geometry", label: "Route Geometry", icon: Spline },
    { id: "elevation", label: "Elevation & Terrain", icon: TrendingUp },
  ];

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

    // Calculate subset metrics
    let distance = 0;

    // Calculate distance for the subset
    for (let i = 1; i < subset.length; i++) {
      const prev = subset[i - 1];
      const curr = subset[i];
      distance += haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    }

    // Calculate time duration
    let timeSeconds = 0;
    const startTime = subset[0].time;
    const endTime = subset[subset.length - 1].time;

    if (startTime && endTime) {
      timeSeconds = (endTime.getTime() - startTime.getTime()) / 1000;
    }

    // Calculate average speed
    // Calculate average speed
    const avgSpeed = timeSeconds > 0 ? distance / (timeSeconds / 3600) : 0;

    let displayTime = timeSeconds;
    let displayAvgSpeed = avgSpeed;

    // Apply speed cap if active (ignores interactive Speed Limiter)
    // Only enforces hard speed_cap for public viewers
    if (!isOwner && speedCap && avgSpeed > speedCap) {
      displayAvgSpeed = speedCap;
      displayTime = displayAvgSpeed > 0 ? distance / (displayAvgSpeed) * 3600 : timeSeconds;
    }

    return {
      filteredPoints: subset,
      subsetStats: {
        distance,
        time: displayTime,
        avgSpeed: displayAvgSpeed
      }
    };
  }, [points, zoomRange, speedCap, isOwner]);


  // Calculate speed limited stats
  const limitedStats = useMemo(() => {
    if (!showLimiter || speedLimit <= 0) return null;
    return calculateLimitedStats(filteredPoints, speedLimit);
  }, [filteredPoints, speedLimit, showLimiter]);

  // Calculate capped display values for public viewers
  const displayStats = useMemo(() => {
    if (!speedCap || isOwner) {
      return {
        maxSpeed: stats.maxSpeed,
        avgSpeed: stats.avgSpeed,
        movingAvgSpeed: stats.movingAvgSpeed,
        totalTime: stats.totalTime,
        movingTime: stats.movingTime,
      };
    }
    // Apply speed cap calculation
    // If a point's speed > speedCap, we pretend it was traveled at speedCap
    // This increases the time taken for that segment
    const limited = calculateLimitedStats(points, speedCap);

    // If limited stats calculation fails or makes no sense, fallback to simple clamp
    if (!limited) {
      return {
        maxSpeed: Math.min(stats.maxSpeed, speedCap),
        avgSpeed: Math.min(stats.avgSpeed, speedCap),
        movingAvgSpeed: Math.min(stats.movingAvgSpeed, speedCap),
        totalTime: stats.totalTime,
        movingTime: stats.movingTime,
      };
    }

    const originalStoppedTime = stats.totalTime - stats.movingTime;
    const newTotalTime = limited.simulatedTime;
    const newMovingTime = Math.max(0, newTotalTime - originalStoppedTime);

    // Recalculate moving avg speed based on new moving time
    const newMovingAvgSpeed = newMovingTime > 0 ? (stats.totalDistance / (newMovingTime / 3600)) : 0;

    return {
      maxSpeed: Math.min(stats.maxSpeed, speedCap),
      avgSpeed: limited.newAvgSpeed,
      movingAvgSpeed: newMovingAvgSpeed,
      totalTime: newTotalTime,
      movingTime: newMovingTime,
    };
  }, [stats, speedCap, isOwner, points]);

  // Effective speed limit for charts (owner's limiter or public speed cap)
  // Effective speed limit for charts
  // Effective speed limit for charts
  const effectiveChartSpeedLimit = useMemo(() => {
    // If the tool is enabled, show the line.
    if (showLimiter) return speedLimit;
    return null;
  }, [showLimiter, speedLimit]);

  // Handle chart hover with privacy clamping
  const handleHoverPoint = (point: GPXPoint | null) => {
    if (!point) {
      setHoveredPoint(null);
      return;
    }

    if (isOwner) {
      setHoveredPoint(point);
      return;
    }

    // Privacy Logic for Public Viewers
    if (!mapPoints || mapPoints.length === 0) {
      setHoveredPoint(null);
      return;
    }

    const safeStart = mapPoints[0];
    const safeEnd = mapPoints[mapPoints.length - 1];

    // Ensure we have valid time objects for comparison
    if (!point.time || !safeStart.time || !safeEnd.time) {
      setHoveredPoint(point); // Fallback if times missing
      return;
    }

    // Clamp to Safe Boundaries based on Time
    // Using getTime() for safe comparison
    const pTime = point.time.getTime();
    const startTime = safeStart.time.getTime();
    const endTime = safeEnd.time.getTime();

    if (pTime < startTime) {
      setHoveredPoint(safeStart);
    } else if (pTime > endTime) {
      setHoveredPoint(safeEnd);
    } else {
      setHoveredPoint(point);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <aside className="w-full lg:w-64 flex-shrink-0">
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
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-background text-foreground p-6 border border-border">
                <div className="flex flex-col md:flex-row gap-8">

                  {/* LEFT SIDE: Avatar & Title (Mirroring Strava's Left Column) */}
                  <div className="flex-shrink-0 md:w-1/3 border-r border-border/50 pr-8">
                    <div className="flex gap-4">
                      <div className="w-16 h-16 rounded-full bg-muted overflow-hidden border border-border">
                        {/* Avatar placeholder or <img /> */}
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground font-bold">AR</div>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground leading-tight">
                          {new Date(stats.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} on {new Date(stats.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <h1 className="text-2xl font-bold tracking-tight mt-1">{fileName}</h1>
                        <span className="flex items-center gap-1.5"><MapPin className="w-3 h-3" /> {stats.pointCount.toLocaleString()} points recorded</span>

                      </div>
                    </div>

                    {/* Description */}
                    {description && (
                      <p className="mt-4 text-sm text-muted-foreground line-clamp-3">
                        {description}
                      </p>
                    )}

                    {/* Visibility Status */}
                    <div className="mt-4 flex items-center gap-2 text-xs">
                      {isPublic ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/30">
                          <Globe className="w-3 h-3" />
                          Public
                          {speedCap && <span className="text-green-400">• Capped at {speedCap} km/h</span>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted text-muted-foreground border border-border">
                          <Lock className="w-3 h-3" />
                          Private
                        </span>
                      )}
                    </div>
                  </div>

                  {/* RIGHT SIDE: Data Grid (The Strava Data Layout) */}
                  <div className="flex-1">
                    {/* 1. Hero Stats (Distance, Time, Elevation) */}
                    <div className="grid grid-cols-3 gap-y-12 gap-x-6 mb-8 items-end">
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatDistance(stats.totalDistance).replace(' km', '')}</span>
                          <span className="text-xl text-muted-foreground ml-1">km</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Distance</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatDuration(displayStats.totalTime)}</span>
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
                          <span className="text-2xl font-normal tabular-nums">{stats.elevationGain.toFixed(0)}</span>
                          <span className="text-xl text-muted-foreground ml-1">m</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Elevation Gained</span>
                      </div>
                      <div>
                        <div className="text-2xl font-normal tabular-nums">{formatDuration(displayStats.movingTime)}</div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Moving Time</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatSpeed(displayStats.movingAvgSpeed).replace(' km/h', '')}</span>
                          <span className="text-xl text-muted-foreground ml-1">km/h</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Average Moving Speed</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatSpeed(displayStats.maxSpeed).replace(' km/h', '')}</span>
                          <span className="text-xl text-muted-foreground ml-1">km/h</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Top Speed</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{formatDuration(stats.stoppedTime)}</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Stopped Time</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-normal tabular-nums">{stats.stopCount}</span>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-2 block">Stops</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Map Section */}
              <div className="bg-card border border-border rounded-2xl p-2 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 text-foreground">Route Map</h3>
                <TrackMap
                  points={mapPoints}
                  hoveredPoint={hoveredPoint}
                  zoomRange={zoomRange}
                  stopPoints={stats.stopPoints}
                  tightTurnPoints={stats.tightTurnPoints}
                  privacyMask={privacyMask}
                />
              </div>

              {/* Speed & Elevation Chart */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                {/* Compact Header & Stats Row */}
                <div className="flex flex-col gap-4 mb-2">
                  <div className="flex items-center justify-between gap-6 mb-4">
                    {/* Left: Title */}
                    <div className="flex-shrink-0">
                      <h3 className="text-lg font-semibold text-foreground">Speed & Elevation Timeline</h3>
                    </div>

                    {/* Middle: Slider (Centered & Flex-grow) */}
                    {showLimiter && (
                      <div className="flex-1 max-w-[400px] px-2 animate-in fade-in zoom-in-95 duration-200">
                        <Slider
                          min={40}
                          max={speedCap ? Math.min(speedCap - 10, 200) : Math.max(Math.ceil(stats.maxSpeed / 10) * 10, 120)}
                          step={10}
                          value={[speedLimit]}
                          onValueChange={([val]) => setSpeedLimit(val)}
                          className="w-full relative py-3 cursor-grab active:cursor-grabbing"

                          // Styles for "Proper" Visible Slider
                          thumbClassName="h-5 w-5 rounded-full border-2 border-primary bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                          // No weird children, just a tooltip on top via internal logic or sibling if needed, 
                          // but user asked for "standard". Let's use the thumbChildren for the value label carefully
                          thumbChildren={
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs font-bold px-2 py-1 rounded shadow-md border whitespace-nowrap">
                              {speedLimit} km/h
                            </div>
                          }
                        />
                      </div>
                    )}

                    {/* Right: Controls (Toggle + Reset) */}
                    <div className="flex items-center gap-4 flex-shrink-0">
                      {/* Speed Limiter Toggle */}
                      <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-full border border-border/50">
                        <Switch
                          id="speed-limiter"
                          checked={showLimiter}
                          onCheckedChange={setShowLimiter}
                          className="data-[state=checked]:bg-amber-500"
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
                  <div className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-3 border border-border/50">
                    <div className="flex items-center gap-10">
                      {/* Distance - Simple Inline */}
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-normal tabular-nums">{zoomRange && subsetStats ? formatDistance(subsetStats.distance) : formatDistance(stats.totalDistance)}</span>
                      </div>

                      {/* Time - Inline with Arrow Delta */}
                      <div className="flex items-baseline gap-2">
                        <span className={cn("text-xl font-normal tabular-nums", showLimiter && limitedStats?.timeAdded > 0 ? "text-muted-foreground/50 line-through" : "text-foreground")}>
                          {zoomRange && subsetStats ? formatDuration(subsetStats.time) : formatDuration(displayStats.totalTime)}
                        </span>
                        {showLimiter && limitedStats && limitedStats.timeAdded > 0 && (
                          <div className="flex items-baseline gap-2 animate-in fade-in slide-in-from-left-2">
                            <span className="text-xl font-normal text-amber-500 tabular-nums">
                              {formatDuration(limitedStats.simulatedTime)}
                            </span>
                            <span className="flex items-center text-xs font-bold text-amber-500/90 gap-1">
                              <TrendingUp className="w-3 h-3" />
                              +{formatDuration(limitedStats.timeAdded)}
                              <span className="text-[10px] opacity-80 uppercase tracking-wide ml-0.5">({((limitedStats.simulatedTime - displayStats.totalTime) / displayStats.totalTime * 100).toFixed(0)}% Slower)</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Speed - Inline with Arrow Delta */}
                      <div className="flex items-baseline gap-2">
                        <span className={cn("text-xl font-normal tabular-nums", showLimiter && limitedStats?.timeAdded > 0 ? "text-muted-foreground/50 line-through" : "text-foreground")}>
                          {zoomRange && subsetStats ? formatSpeed(subsetStats.avgSpeed) : formatSpeed(displayStats.avgSpeed)}
                        </span>
                        {showLimiter && limitedStats && limitedStats.timeAdded > 0 && (
                          <div className="flex items-baseline gap-2 animate-in fade-in slide-in-from-left-2">
                            <span className="text-xl font-normal text-amber-500 tabular-nums">
                              {formatSpeed(limitedStats.newAvgSpeed)}
                            </span>
                            <span className="flex items-center text-xs font-bold text-amber-500/90">
                              <TrendingUp className="w-3 h-3 rotate-180 mr-0.5" />
                              -{formatSpeed((zoomRange && subsetStats ? subsetStats.avgSpeed : displayStats.avgSpeed) - limitedStats.newAvgSpeed)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative h-[300px] w-full">

                  <ResponsiveContainer width="100%" height="100%">
                    <SpeedElevationChart
                      points={points}
                      onHover={handleHoverPoint}
                      onZoomChange={setZoomRange}
                      zoomRange={zoomRange}
                      speedLimit={effectiveChartSpeedLimit}
                      speedCap={!isOwner ? speedCap : null}
                      visualLimit={showLimiter ? speedLimit : undefined}
                    />
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Speed Distribution (Moved to Overview) */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Speed Distribution
                    {zoomRange && <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Filtered to selection</span>}
                    {effectiveChartSpeedLimit && <span className="text-xs font-normal text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">Capped at {effectiveChartSpeedLimit} km/h</span>}
                  </h3>
                </div>
                <div className="h-[250px]">
                  <SpeedDistributionChart
                    points={filteredPoints}
                    speedLimit={!isOwner ? (effectiveChartSpeedLimit ?? speedCap) : effectiveChartSpeedLimit}
                  />
                </div>
              </div>
            </div>
          )}

          {/* MOTION TAB */}
          {activeTab === "motion" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Motion Summary Cards */}
              {/* Dynamics Dashboard */}
              <div>
                <h3 className="text-xl font-bold mb-10">Dynamics Overview</h3>
                <div className="flex flex-wrap gap-16">
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.hardAccelerationCount}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Hard Accels</span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">&gt; 2.5 m/s²</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.hardBrakingCount}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Hard Braking</span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">&lt; -3.0 m/s²</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.turbulenceScore.toFixed(1)}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Turbulence</span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">Score</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.accelBrakeRatio.toFixed(2)}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Accel Ratio</span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">Balance</span>
                  </div>
                </div>
              </div>

              {/* Behavior Analysis Section */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Time Profile */}
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-primary" />
                    Motion Time Profile
                  </h3>
                  <div className="space-y-6">
                    {/* Visual Stacked Bar */}
                    <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
                      {[
                        { seconds: stats.timeAccelerating, color: "bg-emerald-500" },
                        { seconds: stats.timeCruising, color: "bg-blue-500" },
                        { seconds: stats.timeBraking, color: "bg-red-500" },
                        { seconds: stats.stoppedTime, color: "bg-muted-foreground/30" },
                      ].map((item, idx) => {
                        const width = (item.seconds / (stats.totalTime || 1)) * 100;
                        if (width === 0) return null;
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
                        { label: "Accelerating", seconds: stats.timeAccelerating, color: "bg-emerald-500", desc: "Pushing forward" },
                        { label: "Cruising", seconds: stats.timeCruising, color: "bg-blue-500", desc: "Steady speed" },
                        { label: "Braking", seconds: stats.timeBraking, color: "bg-red-500", desc: "Slowing down" },
                        { label: "Stopped", seconds: stats.stoppedTime, color: "bg-muted-foreground/30", desc: "Stationary" },
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

          {/* GEOMETRY TAB */}
          {activeTab === "geometry" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Turn & Heading Summary */}
              {/* Geometry Overview Panel */}
              {/* Geometry Overview Panel - Clean Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-6">turning</h4>
                  <div className="flex gap-12">
                    <div>
                      <span className="block text-2xl font-normal text-foreground">{Math.round(stats.totalHeadingChange).toLocaleString()}°</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Rotation</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground">{stats.twistinessScore.toFixed(0)}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Twistiness</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-6">technical</h4>
                  <div className="flex gap-12">
                    <div>
                      <span className="block text-2xl font-normal text-foreground">{stats.tightTurnsCount}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Tight Turns</span>
                    </div>
                    <div>
                      <span className="block text-2xl font-normal text-foreground">{stats.hairpinCount}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Hairpins</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Advanced Geometry Analysis */}
              <div className="grid grid-cols-1 gap-8">
                {/* Straight vs Curvy Profile */}
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <Spline className="w-5 h-5 text-primary" />
                    Geometry Profile
                  </h3>
                  <div className="space-y-6">
                    {/* Visual Stacked Bar */}
                    <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
                      {[
                        { dist: stats.totalDistance * (stats.percentStraight / 100), color: "bg-blue-500" },
                        { dist: stats.totalDistance * ((100 - stats.percentStraight) / 100), color: "bg-purple-500" },
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
                        { label: "Straight Sections", dist: stats.totalDistance * (stats.percentStraight / 100), color: "bg-blue-500", desc: "Sustained heading" },
                        { label: "Corners & Curves", dist: stats.totalDistance * ((100 - stats.percentStraight) / 100), color: "bg-purple-500", desc: "Frequent turns" },
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
              </div>
            </div>
          )}

          {/* ELEVATION TAB */}
          {activeTab === "elevation" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Elevation Summary Cards */}
              {/* Terrain Overview Grid */}
              <div>
                <h3 className="text-xl font-bold mb-10">Terrain Analysis</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-12 gap-y-12">
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">+{stats.elevationGain.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Gain</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">-{stats.elevationLoss.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Loss</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.elevationGain - stats.elevationLoss > 0 ? "+" : ""}{(stats.elevationGain - stats.elevationLoss).toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Net Change</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.hillinessScore.toFixed(1)}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Hilliness</span>
                  </div>

                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.maxElevation.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Peak</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.minElevation.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Low</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.steepestClimb.toFixed(1)}%</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Max Grade</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground leading-none">{stats.steepestDescent.toFixed(1)}%</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Min Grade</span>
                  </div>
                </div>
              </div>

              {/* Advanced Elevation Analysis */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Terrain Profile */}
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Terrain Time Profile
                  </h3>
                  <div className="space-y-6">
                    {/* Visual Stacked Bar */}
                    <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex shadow-inner">
                      {[
                        { seconds: stats.timeClimbing, color: "bg-orange-500" },
                        { seconds: stats.timeDescending, color: "bg-blue-500" },
                        { seconds: stats.totalTime - stats.timeClimbing - stats.timeDescending, color: "bg-muted-foreground/30" },
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
                        { label: "Climbing", seconds: stats.timeClimbing, color: "bg-orange-500", desc: "Uphill battle" },
                        { label: "Descending", seconds: stats.timeDescending, color: "bg-blue-500", desc: "Gravity assisted" },
                        { label: "Level Flight", seconds: Math.max(0, stats.totalTime - stats.timeClimbing - stats.timeDescending), color: "bg-muted-foreground/30", desc: "Flat terrain" },
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

                {/* Grade Intensity Section */}
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-center text-center">
                  <div className="mb-6">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <TrendingUp className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold">Terrain Intensity</h3>
                    <p className="text-muted-foreground text-sm">Quantifying the vertical challenges of your route</p>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-2">Avg Grade</p>
                      <p className="text-2xl font-normal text-foreground leading-none">
                        {stats.elevationGain > 0 ? ((stats.elevationGain / (stats.climbDistance * 1000 || 1)) * 100).toFixed(1) : "0.0"}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-2">VAM</p>
                      <p className="text-2xl font-normal text-foreground leading-none">
                        {stats.movingTime > 0 ? ((stats.elevationGain / (stats.movingTime / 3600))).toFixed(0) : "0"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div >
    </div >
  );
};

export default GPSStats;
