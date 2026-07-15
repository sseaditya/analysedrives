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
import type { ComparisonSeries, SegmentMatch } from "@/types/segments";
import { calculateNiceYTicks } from "@/utils/chartUtils";
import { chartAxisLabel, chartAxisTick } from "@/utils/chartStyles";

interface TimelineMouseState { activePayload?: Array<{ payload?: { index?: number } }> }

const chartMargin = { top: 10, right: 18, left: 0, bottom: 0 };

function ComparisonGrid({ xTicks, yTicks }: { xTicks: number[]; yTicks: number[] }) {
  return <>
    {yTicks.map((value) => <ReferenceLine key={`y-${value}`} y={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />)}
    {xTicks.map((value) => <ReferenceLine key={`x-${value}`} x={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />)}
  </>;
}

export function ComparisonTimeline({ series, matchA, matchB, onCursor }: { series: ComparisonSeries; matchA: SegmentMatch; matchB: SegmentMatch; onCursor: (index: number) => void }) {
  const data = useMemo(() => series.points.map((point, index) => ({
    index,
    distance: Number(point.distance.toFixed(3)),
    elevation: point.elevation,
    speedA: Number(point.speedA.toFixed(1)),
    speedB: Number(point.speedB.toFixed(1)),
  })), [series]);
  const xConfig = useMemo(() => calculateNiceYTicks(0, series.distance, 7), [series.distance]);
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
    const index = state?.activePayload?.[0]?.payload?.index;
    if (typeof index === "number") onCursor(index);
  };

  return <div className="h-[360px] w-full rounded-2xl border border-border bg-card p-3 select-none">
    <div className="h-[70%] w-full pb-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={chartMargin} onMouseMove={handleMove}>
          <defs>
            <linearGradient id="compareSpeedA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.42} /><stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0} /></linearGradient>
            <linearGradient id="compareSpeedB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--foreground))" stopOpacity={0.18} /><stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0} /></linearGradient>
          </defs>
          <ComparisonGrid xTicks={xConfig.ticks} yTicks={speedConfig.ticks} />
          <XAxis dataKey="distance" type="number" domain={xConfig.domain} ticks={xConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={(value) => `${value} km`} allowDataOverflow />
          <YAxis domain={speedConfig.domain} ticks={speedConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} width={60} label={{ value: "Speed (km/h)", angle: -90, position: "insideLeft", ...chartAxisLabel }} />
          <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "16px", fontSize: "12px" }} formatter={(value: number, name: string) => [`${value.toFixed(1)} km/h`, name]} labelFormatter={(value) => `${value} km`} />
          <Area type="monotone" dataKey="speedA" name={matchA.activity.title} stroke="hsl(var(--segment-drive-1))" strokeWidth={1.5} fill="url(#compareSpeedA)" isAnimationActive={false} />
          <Area type="monotone" dataKey="speedB" name={matchB.activity.title} stroke="hsl(var(--segment-drive-2))" strokeWidth={1.5} fill="url(#compareSpeedB)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    {elevations.length > 0 && <div className="h-[30%] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={chartMargin} onMouseMove={handleMove}>
          <defs><linearGradient id="compareElevation" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.4} /><stop offset="95%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.1} /></linearGradient></defs>
          <ComparisonGrid xTicks={xConfig.ticks} yTicks={elevationConfig.ticks} />
          <XAxis dataKey="distance" type="number" domain={xConfig.domain} ticks={xConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={(value) => `${value} km`} allowDataOverflow />
          <YAxis domain={elevationConfig.domain} ticks={elevationConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} width={60} tickFormatter={(value) => Math.round(value).toString()} />
          <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "16px", fontSize: "12px" }} formatter={(value: number) => [`${value.toFixed(0)} m`, "Elevation"]} labelFormatter={(value) => `${value} km`} />
          <Area type="monotone" dataKey="elevation" name="Elevation" stroke="hsl(0, 0%, 50%)" strokeWidth={1.5} fill="url(#compareElevation)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>}
  </div>;
}

export function ComparisonDistribution({ series, matchA, matchB }: { series: ComparisonSeries; matchA: SegmentMatch; matchB: SegmentMatch }) {
  const [metric, setMetric] = useState<"time" | "distance">("time");
  const data = useMemo(() => {
    const buckets = new Map<number, { range: string; aTime: number; bTime: number; aDistance: number; bDistance: number }>();
    for (let i = 1; i < series.points.length; i++) {
      const point = series.points[i];
      const previous = series.points[i - 1];
      const distance = point.distance - previous.distance;
      ([[point.speedA, "a"], [point.speedB, "b"]] as const).forEach(([speed, side]) => {
        const lower = Math.max(0, Math.floor(speed / 10) * 10);
        const bucket = buckets.get(lower) ?? { range: `${lower}-${lower + 10}`, aTime: 0, bTime: 0, aDistance: 0, bDistance: 0 };
        if (speed > 0) {
          bucket[side === "a" ? "aDistance" : "bDistance"] += distance;
          bucket[side === "a" ? "aTime" : "bTime"] += distance / speed * 60;
        }
        buckets.set(lower, bucket);
      });
    }
    return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, bucket]) => ({ range: bucket.range, driveA: Number((metric === "time" ? bucket.aTime : bucket.aDistance).toFixed(2)), driveB: Number((metric === "time" ? bucket.bTime : bucket.bDistance).toFixed(2)) }));
  }, [series, metric]);
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
