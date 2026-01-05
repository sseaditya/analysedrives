import { useState, useMemo } from "react";
import { MapPin, Activity, TrendingUp, RotateCcw, Spline } from "lucide-react";
import StatCard from "./StatCard";
import TrackMap from "./TrackMap";
import SpeedElevationChart from "./SpeedElevationChart";
import SpeedDistributionChart from "./SpeedDistributionChart";
import { cn } from "@/lib/utils";
import {
  GPXStats,
  GPXPoint,
  formatDistance,
  formatDuration,
  formatSpeed,
  haversineDistance
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Track Analysis</h2>
          <p className="text-muted-foreground">{fileName}</p>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          {stats.startTime && (
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {new Date(stats.startTime).toLocaleDateString(undefined, {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            {stats.pointCount.toLocaleString()} GPS points
          </div>
        </div>
      </div>

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
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                <StatCard
                  label="Total Distance"
                  value={formatDistance(stats.totalDistance)}
                  delay={0}
                />
                <StatCard
                  label="Time Spent"
                  value={formatDuration(stats.totalTime)}
                  subValue={stats.totalTime > 0 ? "Total duration" : "No time data"}
                  delay={100}
                />
                <StatCard
                  label="Stopped Time"
                  value={formatDuration(stats.stoppedTime || 0)}
                  subValue={`${(((stats.stoppedTime || 0) / (stats.totalTime || 1)) * 100).toFixed(1)}% of total`}
                  delay={150}
                />
                <StatCard
                  label="Stop Count"
                  value={(stats.stopCount || 0).toString()}
                  subValue="Full stops"
                  delay={200}
                />
                <StatCard
                  label="Average Speed"
                  value={formatSpeed(stats.avgSpeed)}
                  subValue="Total Average"
                  delay={250}
                />
                <StatCard
                  label="Moving Speed"
                  value={formatSpeed(stats.movingAvgSpeed || stats.avgSpeed)}
                  subValue="Moving Average"
                  delay={300}
                />
                <StatCard
                  label="Max Speed"
                  value={formatSpeed(stats.maxSpeed)}
                  delay={350}
                />
                <StatCard
                  label="Elevation Gain"
                  value={`${stats.elevationGain.toFixed(0)} m`}
                  subValue={stats.elevationGain > 0 ? "Total climb" : "No elevation data"}
                  delay={400}
                />
              </div>

              {/* Map Section */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
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
                <SpeedElevationChart points={points} onHover={setHoveredPoint} onZoomChange={setZoomRange} zoomRange={zoomRange} />
              </div>

              {/* Speed Distribution (Moved to Overview) */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Speed Distribution
                    {zoomRange && <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Filtered to selection</span>}
                  </h3>
                </div>
                <div className="h-[250px]">
                  <SpeedDistributionChart points={filteredPoints} />
                </div>
              </div>
            </div>
          )}

          {/* MOTION TAB */}
          {activeTab === "motion" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Motion Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label="Hard Accelerations"
                  value={stats.hardAccelerationCount.toString()}
                  subValue="> 2.5 m/s² events"
                  delay={0}
                />
                <StatCard
                  label="Hard Braking"
                  value={stats.hardBrakingCount.toString()}
                  subValue="< -3.0 m/s² events"
                  delay={100}
                />
                <StatCard
                  label="Turbulence Score"
                  value={stats.turbulenceScore.toFixed(1)}
                  subValue="Stability index"
                  delay={200}
                />
                <StatCard
                  label="Accel/Brake Ratio"
                  value={stats.accelBrakeRatio.toFixed(2)}
                  subValue="Time balance"
                  delay={300}
                />
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Total Heading Change"
                  value={`${Math.round(stats.totalHeadingChange).toLocaleString()}°`}
                  subValue="Combined rotation"
                  delay={0}
                />
                <StatCard
                  label="Tight Turns"
                  value={stats.tightTurnsCount.toString()}
                  subValue="Turns > 45°"
                  delay={100}
                />
                <StatCard
                  label="Hairpin Turns"
                  value={stats.hairpinCount.toString()}
                  subValue="Turns > 135°"
                  delay={200}
                />
                <StatCard
                  label="Twistiness Score"
                  value={stats.twistinessScore.toFixed(0)}
                  subValue="Degrees / km"
                  delay={300}
                />
              </div>

              {/* Straight Section Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Longest Straight"
                  value={formatDistance(stats.longestStraightSection)}
                  subValue="Continuous"
                  delay={400}
                />
                <StatCard
                  label="Median Straight"
                  value={formatDistance(stats.medianStraightLength)}
                  subValue="Average section"
                  delay={500}
                />
                <StatCard
                  label="Straight Route"
                  value={`${stats.percentStraight.toFixed(1)}%`}
                  subValue="Ratio"
                  delay={600}
                />
                <StatCard
                  label="Route Curvature"
                  value={`${(100 - stats.percentStraight).toFixed(1)}%`}
                  subValue="Curvy sections"
                  delay={700}
                />
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

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-1">Turns / km</p>
                      <p className="text-2xl font-black text-foreground">
                        {stats.totalDistance > 0 ? ((stats.tightTurnsCount / stats.totalDistance)).toFixed(1) : "0.0"}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-1">Complexity</p>
                      <p className="text-2xl font-black text-foreground uppercase text-primary">
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Elevation Gain"
                  value={`${stats.elevationGain.toFixed(0)} m`}
                  subValue="Total ascent"
                  delay={0}
                />
                <StatCard
                  label="Elevation Loss"
                  value={`${stats.elevationLoss.toFixed(0)} m`}
                  subValue="Total descent"
                  delay={100}
                />
                <StatCard
                  label="Highest Point"
                  value={`${stats.maxElevation.toFixed(0)} m`}
                  subValue="Max altitude"
                  delay={200}
                />
                <StatCard
                  label="Lowest Point"
                  value={`${stats.minElevation.toFixed(0)} m`}
                  subValue="Min altitude"
                  delay={300}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  label="Steepest Climb"
                  value={`${stats.steepestClimb.toFixed(1)}%`}
                  subValue="Max gradient"
                  delay={400}
                />
                <StatCard
                  label="Steepest Descent"
                  value={`${stats.steepestDescent.toFixed(1)}%`}
                  subValue="Min gradient"
                  delay={500}
                />
                <StatCard
                  label="Hilliness Score"
                  value={stats.hillinessScore.toFixed(1)}
                  subValue="m/km intensity"
                  delay={600}
                />
                <StatCard
                  label="Net Change"
                  value={`${(stats.elevationGain - stats.elevationLoss).toFixed(0)} m`}
                  subValue="Vertical displacement"
                  delay={700}
                />
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

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-1">Avg Grade</p>
                      <p className="text-2xl font-black text-foreground">
                        {stats.elevationGain > 0 ? ((stats.elevationGain / (stats.climbDistance * 1000 || 1)) * 100).toFixed(1) : "0.0"}%
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground mb-1">VAM</p>
                      <p className="text-2xl font-black text-foreground">
                        {stats.movingTime > 0 ? ((stats.elevationGain / (stats.movingTime / 3600))).toFixed(0) : "0"}
                      </p>
                      <p className="text-[8px] text-muted-foreground mt-1">Vertical Meters/Hour</p>
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
