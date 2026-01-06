import { useState, useMemo } from "react";
import { MapPin, Activity, TrendingUp, Compass, RotateCcw, MoveRight, GitCommit, Spline, Gauge, Clock, AlertTriangle } from "lucide-react";
import TrackMap from "./TrackMap";
import SpeedElevationChart from "./SpeedElevationChart";
import SpeedDistributionChart from "./SpeedDistributionChart";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import {
  GPXStats,
  GPXPoint,
  formatDistance,
  formatDuration,
  formatSpeed,
  haversineDistance,
  calculateLimitedStats
} from "@/utils/gpxParser";

interface GPSStatsProps {
  stats: GPXStats;
  fileName: string;
  points: GPXPoint[];
}

const GPSStats = ({ stats, fileName, points }: GPSStatsProps) => {
  const [hoveredPoint, setHoveredPoint] = useState<GPXPoint | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [speedLimit, setSpeedLimit] = useState<number>(Math.max(40, Math.floor((stats.maxSpeed * 0.8) / 10) * 10));
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
    const avgSpeed = timeSeconds > 0 ? distance / (timeSeconds / 3600) : 0;

    return {
      filteredPoints: subset,
      subsetStats: {
        distance,
        time: timeSeconds,
        avgSpeed
      }
    };
  }, [points, zoomRange]);

  // Calculate speed limited stats
  const limitedStats = useMemo(() => {
    if (!showLimiter || speedLimit <= 0) return null;
    return calculateLimitedStats(filteredPoints, speedLimit);
  }, [filteredPoints, speedLimit, showLimiter]);


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

        {/* Main Content Area */}
        <main className="flex-1 space-y-8 min-w-0">

          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Metadata & Hero Stats */}
              <div>
                <div className="mb-10">
                  <h1 className="text-4xl font-black text-foreground mb-2">{fileName}</h1>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {stats.startTime && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        {new Date(stats.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} on {new Date(stats.startTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" />
                      {stats.pointCount.toLocaleString()} points
                    </span>
                  </div>
                </div>

                {/* Primary Row */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-10 gap-y-8 pt-8 max-w-full">
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{formatDistance(stats.totalDistance).replace(' km', '')}<span className="text-xl text-muted-foreground ml-1">km</span></span>
                    <span className="text-xs text-muted-foreground mt-1 block">Distance</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{formatDuration(stats.totalTime)}</span>
                    <span className="text-xs text-muted-foreground mt-1 block">Elapsed Time</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{formatDuration(stats.movingTime)}</span>
                    <span className="text-xs text-muted-foreground mt-1 block">Moving Time</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{stats.elevationGain.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs text-muted-foreground mt-1 block">Elevation Gained</span>
                  </div>
                </div>

                {/* Secondary Row Table */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-10 gap-y-8 pt-8 max-w-full">
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{formatSpeed(stats.maxSpeed)}</span>
                    <span className="text-xs text-muted-foreground mt-1 block">Top Speed</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{formatSpeed(stats.avgSpeed)}</span>
                    <span className="text-xs text-muted-foreground mt-1 block">Average Speed</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{formatSpeed(stats.movingAvgSpeed)}</span>
                    <span className="text-xs text-muted-foreground mt-1 block">Moving Average Speed</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{formatDuration(stats.stoppedTime)}</span>
                    <span className="text-xs text-muted-foreground mt-1 block">Stopped Time</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-normal text-foreground">{stats.stopCount}</span>
                    <span className="text-xs text-muted-foreground mt-1 block">Stops</span>
                  </div>
                </div>
              </div>

              {/* Map Section */}
              <div className="bg-card border border-border rounded-2xl p-2 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 text-foreground">Route Map</h3>
                <TrackMap points={points} hoveredPoint={hoveredPoint} zoomRange={zoomRange} stopPoints={stats.stopPoints} tightTurnPoints={stats.tightTurnPoints} />
              </div>

              {/* Speed & Elevation Chart */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex flex-col gap-4 mb-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">Speed & Elevation Timeline</h3>
                    {zoomRange && (
                      <span className="text-sm text-primary cursor-pointer hover:underline font-medium" onClick={() => setZoomRange(null)}>
                        Reset Selection
                      </span>
                    )}
                  </div>

                  {/* Selected Range Stats */}
                  {zoomRange && subsetStats && (
                    <div className="grid grid-cols-3 gap-4 bg-muted/50 p-3 rounded-xl border border-border/50 animate-in fade-in slide-in-from-top-2">
                      <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Distance</p>
                        <p className="text-lg font-bold text-foreground">{formatDistance(subsetStats.distance)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Time</p>
                        <p className="text-lg font-bold text-foreground">{formatDuration(subsetStats.time)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Avg Speed</p>
                        <p className="text-lg font-bold text-foreground">{formatSpeed(subsetStats.avgSpeed)}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Speed Limiter Toggle & Slider */}
                <div className="flex items-center gap-4 mb-4">
                  <button
                    onClick={() => setShowLimiter(!showLimiter)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-all",
                      showLimiter
                        ? "bg-amber-500/20 text-amber-500 border border-amber-500/50"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    <Gauge className="w-4 h-4" />
                    Speed Limiter
                  </button>

                  {showLimiter && (
                    <div className="flex-1 flex items-center gap-4 animate-in fade-in slide-in-from-left-2">
                      <Slider
                        value={[speedLimit]}
                        onValueChange={([val]) => setSpeedLimit(val)}
                        min={40}
                        max={Math.max(Math.ceil(stats.maxSpeed / 10) * 10, 120)}
                        step={10}
                        className="flex-1 max-w-xs"
                      />
                      <span className="text-sm font-mono font-bold text-amber-500 min-w-[60px]">
                        {speedLimit} km/h
                      </span>
                    </div>
                  )}
                </div>

                {/* What-If Stats Panel */}
                {showLimiter && limitedStats && limitedStats.timeAdded > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <span className="font-semibold text-amber-500">What If You Stayed Under {speedLimit} km/h?</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Time Added</p>
                        <p className="text-lg font-bold text-red-500">+{formatDuration(limitedStats.timeAdded)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">New Total Time</p>
                        <p className="text-lg font-bold text-foreground">{formatDuration(limitedStats.simulatedTime)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">New Avg Speed</p>
                        <p className="text-lg font-bold text-foreground">{formatSpeed(limitedStats.newAvgSpeed)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Slower By</p>
                        <p className="text-lg font-bold text-amber-500">{limitedStats.percentSlower.toFixed(1)}%</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      {limitedStats.cappedSegments} of {limitedStats.totalSegments} segments exceeded the limit.
                    </p>
                  </div>
                )}

                <SpeedElevationChart
                  points={points}
                  onHover={setHoveredPoint}
                  onZoomChange={setZoomRange}
                  zoomRange={zoomRange}
                  speedLimit={showLimiter ? speedLimit : null}
                />
              </div>

              {/* Speed Distribution (Moved to Overview) */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Speed Distribution
                    {zoomRange && <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Filtered to selection</span>}
                    {showLimiter && <span className="text-xs font-normal text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">Capped at {speedLimit} km/h</span>}
                  </h3>
                </div>
                <div className="h-[250px]">
                  <SpeedDistributionChart points={filteredPoints} speedLimit={showLimiter ? speedLimit : null} />
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
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.hardAccelerationCount}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Hard Accels</span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">&gt; 2.5 m/s²</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.hardBrakingCount}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Hard Braking</span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">&lt; -3.0 m/s²</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.turbulenceScore.toFixed(1)}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Turbulence</span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">Score</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.accelBrakeRatio.toFixed(2)}</span>
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
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-6">turning</h4>
                  <div className="flex gap-12">
                    <div>
                      <span className="block text-4xl font-normal text-foreground">{Math.round(stats.totalHeadingChange).toLocaleString()}°</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Rotation</span>
                    </div>
                    <div>
                      <span className="block text-4xl font-normal text-foreground">{stats.twistinessScore.toFixed(0)}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Twistiness</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-6">technical</h4>
                  <div className="flex gap-12">
                    <div>
                      <span className="block text-4xl font-normal text-foreground">{stats.tightTurnsCount}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Tight Turns</span>
                    </div>
                    <div>
                      <span className="block text-4xl font-normal text-foreground">{stats.hairpinCount}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Hairpins</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-6">straights</h4>
                  <div className="flex gap-12">
                    <div>
                      <span className="block text-4xl font-normal text-foreground">{formatDistance(stats.longestStraightSection)}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Longest</span>
                    </div>
                    <div>
                      <span className="block text-4xl font-normal text-foreground">{stats.percentStraight.toFixed(1)}%</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Straight %</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Advanced Geometry Analysis */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
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

                {/* Turn Intensity Section */}
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-center text-center">
                  <div className="mb-6">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <RotateCcw className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold">Turn Intensity</h3>
                    <p className="text-muted-foreground text-sm">Characterizing the technicality of the route</p>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-2">Turns / km</p>
                      <p className="text-4xl font-normal text-foreground leading-none">
                        {stats.totalDistance > 0 ? ((stats.tightTurnsCount / stats.totalDistance)).toFixed(1) : "0.0"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-2">Complexity</p>
                      <p className="text-4xl font-normal text-foreground uppercase leading-none">
                        {stats.twistinessScore < 100 ? "Low" : stats.twistinessScore < 500 ? "Medium" : "High"}
                      </p>
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
                    <span className="block text-4xl font-normal text-foreground leading-none">+{stats.elevationGain.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Gain</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">-{stats.elevationLoss.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Loss</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.elevationGain - stats.elevationLoss > 0 ? "+" : ""}{(stats.elevationGain - stats.elevationLoss).toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Net Change</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.hillinessScore.toFixed(1)}</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Hilliness</span>
                  </div>

                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.maxElevation.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Peak</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.minElevation.toFixed(0)}<span className="text-xl text-muted-foreground ml-1">m</span></span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Low</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.steepestClimb.toFixed(1)}%</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2 block">Max Grade</span>
                  </div>
                  <div>
                    <span className="block text-4xl font-normal text-foreground leading-none">{stats.steepestDescent.toFixed(1)}%</span>
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
                      <p className="text-4xl font-normal text-foreground leading-none">
                        {stats.elevationGain > 0 ? ((stats.elevationGain / (stats.climbDistance * 1000 || 1)) * 100).toFixed(1) : "0.0"}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-2">VAM</p>
                      <p className="text-4xl font-normal text-foreground leading-none">
                        {stats.movingTime > 0 ? ((stats.elevationGain / (stats.movingTime / 3600))).toFixed(0) : "0"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

export default GPSStats;
