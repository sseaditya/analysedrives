import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import type { ComparisonSeries, SegmentMatch } from "@/types/segments";

interface TimelineMouseState { activePayload?: Array<{ payload?: { index?: number } }> }

export function ComparisonTimeline({ series, matchA, matchB, onCursor }: { series: ComparisonSeries; matchA: SegmentMatch; matchB: SegmentMatch; onCursor: (index: number) => void }) {
  const data = useMemo(() => series.points.map((point, index) => ({ index, distance: Number(point.distance.toFixed(2)), elevation: point.elevation, speedA: Number(point.speedA.toFixed(1)), speedB: Number(point.speedB.toFixed(1)) })), [series]);
  return <div className="h-[360px] w-full"><ResponsiveContainer><ComposedChart data={data} margin={{ top: 15, right: 12, bottom: 20, left: 0 }} onMouseMove={(state: TimelineMouseState) => { const index = state?.activePayload?.[0]?.payload?.index; if (typeof index === "number") onCursor(index); }}>
    <defs><linearGradient id="compareElevation" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#94a3b8" stopOpacity={0.35} /><stop offset="95%" stopColor="#94a3b8" stopOpacity={0.03} /></linearGradient></defs>
    <CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="distance" type="number" domain={[0, "dataMax"]} tickFormatter={(value) => `${value}km`} /><YAxis yAxisId="speed" tickFormatter={(value) => `${value}`} label={{ value: "km/h", angle: -90, position: "insideLeft" }} /><YAxis yAxisId="elevation" orientation="right" tickFormatter={(value) => `${value}m`} />
    <Tooltip formatter={(value: number, name: string) => [name === "elevation" ? `${value?.toFixed?.(0) ?? value} m` : `${value?.toFixed?.(1) ?? value} km/h`, name]} labelFormatter={(value) => `${value} km`} /><Legend />
    <Area yAxisId="elevation" type="monotone" dataKey="elevation" name="Segment elevation" stroke="#94a3b8" fill="url(#compareElevation)" />
    <Line yAxisId="speed" type="monotone" dataKey="speedA" name={matchA.activity.title} stroke="#f97316" strokeWidth={2.5} dot={false} connectNulls />
    <Line yAxisId="speed" type="monotone" dataKey="speedB" name={matchB.activity.title} stroke="#3b82f6" strokeWidth={2.5} dot={false} connectNulls />
  </ComposedChart></ResponsiveContainer></div>;
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
  return <div><div className="mb-4 flex justify-end gap-2"><Button size="sm" variant={metric === "time" ? "default" : "outline"} onClick={() => setMetric("time")}>Time</Button><Button size="sm" variant={metric === "distance" ? "default" : "outline"} onClick={() => setMetric("distance")}>Distance</Button></div><div className="h-[300px]"><ResponsiveContainer><BarChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="range" /><YAxis tickFormatter={(value) => `${value}${metric === "time" ? "m" : "km"}`} /><Tooltip formatter={(value: number) => `${value.toFixed(2)} ${metric === "time" ? "min" : "km"}`} /><Legend /><Bar dataKey="driveA" name={matchA.activity.title} fill="#f97316" fillOpacity={0.6} stroke="#f97316" /><Bar dataKey="driveB" name={matchB.activity.title} fill="#3b82f6" fillOpacity={0.55} stroke="#3b82f6" /></BarChart></ResponsiveContainer></div></div>;
}
