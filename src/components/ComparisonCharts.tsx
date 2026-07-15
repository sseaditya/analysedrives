import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ComparisonSeries, SegmentMatch } from "@/types/segments";
import { calculateNiceTicks, calculateNiceYTicks } from "@/utils/chartUtils";
import { chartAxisLabel, chartAxisTick } from "@/utils/chartStyles";
import { comparisonSpeedDistribution } from "@/utils/segmentMatching";

interface TimelineDataPoint {
  index: number;
  distance: number;
  comparisonTime: number;
  elapsedA: number;
  elapsedB: number;
  elevation: number | null;
  speedA: number;
  speedB: number;
}

interface TimelineMouseState { activePayload?: Array<{ payload?: TimelineDataPoint }> }

const chartMargin = { top: 10, right: 30, left: 0, bottom: 0 };

function ComparisonGrid({ xTicks, yTicks }: { xTicks: number[]; yTicks: number[] }) {
  return <>
    {yTicks.map((value) => <ReferenceLine key={`y-${value}`} y={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />)}
    {xTicks.map((value) => <ReferenceLine key={`x-${value}`} x={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />)}
  </>;
}

function formatTimeAxis(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function ComparisonTimeline({ series, matchA, matchB, onCursor }: { series: ComparisonSeries; matchA: SegmentMatch; matchB: SegmentMatch; onCursor: (index: number) => void }) {
  const isMobile = useIsMobile();
  const [hoverDistance, setHoverDistance] = useState<number | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<TimelineDataPoint | null>(null);
  const [xAxisMode, setXAxisMode] = useState<"distance" | "time">("distance");
  const targetPoints = isMobile ? 200 : 500;
  const data = useMemo(() => {
    const raw = series.points;
    if (!raw.length) return [];
    const count = Math.min(raw.length, targetPoints);
    const selectedIndexes = Array.from({ length: count }, (_, position) => (
      count === 1 ? 0 : Math.round(position * (raw.length - 1) / (count - 1))
    ));

    return selectedIndexes.map((index) => {
      const windowStart = Math.max(0, index - 2);
      const windowEnd = Math.min(raw.length - 1, index + 2);
      let speedA = 0;
      let speedB = 0;
      for (let sample = windowStart; sample <= windowEnd; sample++) {
        speedA += raw[sample].speedA;
        speedB += raw[sample].speedB;
      }
      const sampleCount = windowEnd - windowStart + 1;
      return {
        index,
        distance: raw[index].distance,
        comparisonTime: (raw[index].elapsedA + raw[index].elapsedB) / 2,
        elapsedA: raw[index].elapsedA,
        elapsedB: raw[index].elapsedB,
        elevation: raw[index].elevation,
        speedA: Number((speedA / sampleCount).toFixed(1)),
        speedB: Number((speedB / sampleCount).toFixed(1)),
      };
    });
  }, [series, targetPoints]);
  const xDataKey = xAxisMode === "distance" ? "distance" : "comparisonTime";
  const xMaximum = xAxisMode === "distance" ? series.distance : data.at(-1)?.comparisonTime ?? 0;
  const xDomain = useMemo<[number, number]>(() => [0, xMaximum], [xMaximum]);
  const xTicks = useMemo(() => calculateNiceTicks(0, xMaximum, xAxisMode, 8), [xMaximum, xAxisMode]);
  const speedConfig = useMemo(() => calculateNiceYTicks(0, Math.max(1, ...data.flatMap((point) => [point.speedA, point.speedB])), 7), [data]);
  const elevations = useMemo(() => data.flatMap((point) => point.elevation == null ? [] : [point.elevation]), [data]);
  const elevationConfig = useMemo(() => {
    if (!elevations.length) return calculateNiceYTicks(0, 100, 3);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const padding = Math.max(5, (max - min) * 0.05);
    return calculateNiceYTicks(min - padding, max + padding, 3);
  }, [elevations]);
  const handleMove = (state: TimelineMouseState) => {
    const point = state?.activePayload?.[0]?.payload;
    if (typeof point?.index === "number") {
      setHoverDistance(point[xDataKey]);
      setHoveredPoint(point);
      onCursor(point.index);
    }
  };
  const formatDistanceAxis = (value: number) => Number.isInteger(value) ? `${value} km` : `${Number(value.toFixed(1))} km`;
  const xFormatter = xAxisMode === "distance" ? formatDistanceAxis : formatTimeAxis;
  const clearHover = () => { setHoverDistance(null); setHoveredPoint(null); };

  return <div className="space-y-3">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-h-9 flex-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm">
        {hoveredPoint ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
          <span className="text-[hsl(var(--segment-drive-1))]"><strong>Drive 1</strong> · {hoveredPoint.speedA.toFixed(1)} km/h · {hoveredPoint.distance.toFixed(2)} km · {formatElapsed(hoveredPoint.elapsedA)}</span>
          <span className="text-[hsl(var(--segment-drive-2))]"><strong>Drive 2</strong> · {hoveredPoint.speedB.toFixed(1)} km/h · {hoveredPoint.distance.toFixed(2)} km · {formatElapsed(hoveredPoint.elapsedB)}</span>
          {hoveredPoint.elevation != null && <span className="text-muted-foreground"><strong>Elevation</strong> · {hoveredPoint.elevation.toFixed(0)} m</span>}
        </div> : <span className="text-muted-foreground">Hover over the profile to inspect both drives at the same point.</span>}
      </div>
      <div className="flex items-center gap-2 self-end rounded-full border border-border/50 bg-muted/50 px-2.5 py-1">
        <button onClick={() => setXAxisMode("distance")} className={`rounded-md px-2 py-0.5 text-xs font-semibold transition-colors ${xAxisMode === "distance" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Distance</button>
        <button onClick={() => setXAxisMode("time")} className={`rounded-md px-2 py-0.5 text-xs font-semibold transition-colors ${xAxisMode === "time" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Time</button>
      </div>
    </div>
    <div className="flex h-[300px] w-full cursor-crosshair select-none flex-col rounded-2xl border border-border bg-card p-3">
    <div className="mb-4 min-h-0 w-full flex-[7]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={chartMargin} onMouseMove={handleMove} onMouseLeave={clearHover}>
          <defs>
            <linearGradient id="compareSpeedA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.42} /><stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0} /></linearGradient>
            <linearGradient id="compareSpeedB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--foreground))" stopOpacity={0.18} /><stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0} /></linearGradient>
          </defs>
          <ComparisonGrid xTicks={xTicks} yTicks={speedConfig.ticks} />
          <XAxis dataKey={xDataKey} type="number" domain={xDomain} ticks={xTicks} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={xFormatter} minTickGap={12} allowDataOverflow />
          <YAxis domain={speedConfig.domain} ticks={speedConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} width={60} tickFormatter={(value) => Math.round(value).toString()} label={{ value: "Speed (km/h)", angle: -90, position: "insideLeft", ...chartAxisLabel }} />
          <Area type="monotone" dataKey="speedA" name={matchA.activity.title} stroke="hsl(var(--segment-drive-1))" strokeWidth={isMobile ? 1 : 1.5} fill="url(#compareSpeedA)" dot={false} activeDot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="speedB" name={matchB.activity.title} stroke="hsl(var(--segment-drive-2))" strokeWidth={isMobile ? 1 : 1.5} fill="url(#compareSpeedB)" dot={false} activeDot={false} isAnimationActive={false} />
          {hoverDistance !== null && <ReferenceLine x={hoverDistance} stroke="hsl(var(--foreground))" strokeOpacity={1} isFront />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
    {elevations.length > 0 && <div className="min-h-0 w-full flex-[2.5]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={chartMargin} onMouseMove={handleMove} onMouseLeave={clearHover}>
          <defs><linearGradient id="compareElevation" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.4} /><stop offset="95%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.1} /></linearGradient></defs>
          <ComparisonGrid xTicks={xTicks} yTicks={elevationConfig.ticks} />
          <XAxis dataKey={xDataKey} type="number" domain={xDomain} ticks={xTicks} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={xFormatter} minTickGap={12} allowDataOverflow />
          <YAxis domain={elevationConfig.domain} ticks={elevationConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} width={60} tickFormatter={(value) => Math.round(value).toString()} />
          <Area type="monotone" dataKey="elevation" name="Elevation" stroke="hsl(0, 0%, 50%)" strokeWidth={1.5} fill="url(#compareElevation)" dot={false} activeDot={false} isAnimationActive={false} />
          {hoverDistance !== null && <ReferenceLine x={hoverDistance} stroke="hsl(var(--foreground))" strokeOpacity={1} isFront />}
        </AreaChart>
      </ResponsiveContainer>
    </div>}
    </div>
  </div>;
}

export function ComparisonDistribution({ series, matchA, matchB, viewerId }: { series: ComparisonSeries; matchA: SegmentMatch; matchB: SegmentMatch; viewerId: string }) {
  const [metric, setMetric] = useState<"time" | "distance">("time");
  const bucketsA = useMemo(() => comparisonSpeedDistribution(series, matchA, viewerId), [series, matchA, viewerId]);
  const bucketsB = useMemo(() => comparisonSpeedDistribution(series, matchB, viewerId), [series, matchB, viewerId]);
  const data = useMemo(() => {
    const bySpeedA = new Map(bucketsA.map((bucket) => [bucket.minSpeed, bucket]));
    const bySpeedB = new Map(bucketsB.map((bucket) => [bucket.minSpeed, bucket]));
    const speeds = [...new Set([...bySpeedA.keys(), ...bySpeedB.keys()])].sort((a, b) => a - b);
    return speeds.map((speed) => {
      const bucketA = bySpeedA.get(speed);
      const bucketB = bySpeedB.get(speed);
      return {
        range: bucketA?.range ?? bucketB?.range ?? `${speed}-${speed + 10}`,
        driveA: metric === "time" ? bucketA?.time ?? 0 : bucketA?.distance ?? 0,
        driveB: metric === "time" ? bucketB?.time ?? 0 : bucketB?.distance ?? 0,
      };
    });
  }, [bucketsA, bucketsB, metric]);
  const yConfig = useMemo(() => calculateNiceYTicks(0, Math.max(1, ...data.flatMap((point) => [point.driveA, point.driveB])), 7), [data]);
  return <div><div className="mb-4 flex justify-end"><div className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/50 p-1"><Button className="h-7 rounded-full px-3 text-xs" size="sm" variant={metric === "time" ? "default" : "ghost"} onClick={() => setMetric("time")}>Time</Button><Button className="h-7 rounded-full px-3 text-xs" size="sm" variant={metric === "distance" ? "default" : "ghost"} onClick={() => setMetric("distance")}>Distance</Button></div></div><div className="h-[250px]"><ResponsiveContainer><BarChart data={data} margin={{ top: 10, right: 6, left: -12, bottom: 30 }}>
    <defs><linearGradient id="compareDistA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.8} /><stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.1} /></linearGradient><linearGradient id="compareDistB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--foreground))" stopOpacity={0.8} /><stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0.1} /></linearGradient></defs>
    {yConfig.ticks.map((value) => <ReferenceLine key={value} y={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />)}
    <XAxis dataKey="range" tick={chartAxisTick} tickLine={false} axisLine={false} label={{ value: "Speed Range (km/h)", position: "insideBottom", offset: -8, dy: 5, ...chartAxisLabel }} />
    <YAxis domain={yConfig.domain} ticks={yConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}${metric === "time" ? "m" : "km"}`} />
    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "16px", fontSize: "12px" }} cursor={{ fill: "hsl(var(--muted)/0.2)" }} formatter={(value: number) => `${value.toFixed(2)} ${metric === "time" ? "min" : "km"}`} />
    <Bar dataKey="driveA" name={matchA.activity.title} fill="url(#compareDistA)" stroke="hsl(var(--segment-drive-1))" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={40} />
    <Bar dataKey="driveB" name={matchB.activity.title} fill="url(#compareDistB)" stroke="hsl(var(--segment-drive-2))" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={40} />
  </BarChart></ResponsiveContainer></div></div>;
}
