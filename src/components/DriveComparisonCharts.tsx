import { useEffect, useMemo, useRef, useState } from "react";
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
import { sampleDriveAtElapsed } from "@/lib/driveComparison";
import type { DriveComparisonSample, DriveComparisonTrack } from "@/types/driveComparison";
import { calculateNiceTicks, calculateNiceYTicks } from "@/utils/chartUtils";
import { chartAxisLabel, chartAxisTick } from "@/utils/chartStyles";
import { formatDuration } from "@/utils/gpxParser";

interface TimelinePoint {
  elapsed: number;
  distanceA: number;
  distanceB: number;
  speedA: number;
  speedB: number;
  elevationA: number | null;
  elevationB: number | null;
}

interface TimelineMouseState {
  activePayload?: Array<{ payload?: TimelinePoint }>;
}

const READOUT_INTERVAL_MS = 200;

function formatTimeAxis(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function ReadoutSide({
  sample,
  colorClass,
  side,
}: {
  sample: DriveComparisonSample;
  colorClass: string;
  side: "Drive 1" | "Drive 2";
}) {
  const values = [
    `${sample.speed.toFixed(1)} km/h`,
    `${sample.distance.toFixed(1)} km`,
    sample.elevation == null ? "—" : `${sample.elevation.toFixed(0)} m`,
  ];
  const labels = ["Speed", "Distance", "Elevation"];
  return (
    <>
      {values.map((value, index) => (
        <td
          key={labels[index]}
          aria-label={`${side} ${labels[index]}`}
          className={`whitespace-nowrap px-2 py-2 text-center font-mono text-xs font-semibold tabular-nums sm:text-sm ${colorClass}`}
        >
          {value}
        </td>
      ))}
    </>
  );
}

function TimelineReadout({
  elapsed,
  driveA,
  driveB,
}: {
  elapsed: number;
  driveA: DriveComparisonTrack;
  driveB: DriveComparisonTrack;
}) {
  const sampleA = sampleDriveAtElapsed(driveA, elapsed);
  const sampleB = sampleDriveAtElapsed(driveB, elapsed);
  return (
    <div data-testid="whole-drive-comparison-readout" className="w-full overflow-x-auto">
      <table className="w-full min-w-[34rem] table-fixed border-collapse md:min-w-0">
        <caption className="sr-only">Drive comparison at {formatDuration(elapsed)}</caption>
        <tbody>
          <tr className="divide-x divide-border/60">
            <ReadoutSide sample={sampleA} side="Drive 1" colorClass="text-[hsl(var(--segment-drive-1))]" />
            <td aria-label="Time" className="whitespace-nowrap px-2 py-2 text-center font-mono text-xs font-bold tabular-nums text-foreground sm:text-sm">
              {formatDuration(elapsed)}
            </td>
            <ReadoutSide sample={sampleB} side="Drive 2" colorClass="text-[hsl(var(--segment-drive-2))]" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ComparisonGrid({ xTicks, yTicks }: { xTicks: number[]; yTicks: number[] }) {
  return (
    <>
      {yTicks.map((value) => <ReferenceLine key={`y-${value}`} y={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />)}
      {xTicks.map((value) => <ReferenceLine key={`x-${value}`} x={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />)}
    </>
  );
}

export function DriveComparisonTimeline({
  driveA,
  driveB,
  cursorValue,
  playing,
  onCursor,
}: {
  driveA: DriveComparisonTrack;
  driveB: DriveComparisonTrack;
  cursorValue: number;
  playing: boolean;
  onCursor: (value: number) => void;
}) {
  const isMobile = useIsMobile();
  const [hoverElapsed, setHoverElapsed] = useState<number | null>(null);
  const [autoReadoutElapsed, setAutoReadoutElapsed] = useState<number | null>(null);
  const latestCursorRef = useRef(cursorValue);
  const maximum = Math.max(driveA.duration, driveB.duration);
  const targetCount = isMobile ? 200 : 500;
  const data = useMemo<TimelinePoint[]>(() => {
    const count = Math.min(targetCount, Math.max(2, Math.ceil(maximum) + 1));
    return Array.from({ length: count }, (_, index) => {
      const elapsed = index * maximum / (count - 1);
      const sampleA = sampleDriveAtElapsed(driveA, elapsed);
      const sampleB = sampleDriveAtElapsed(driveB, elapsed);
      return {
        elapsed,
        distanceA: sampleA.distance,
        distanceB: sampleB.distance,
        speedA: Number(sampleA.speed.toFixed(1)),
        speedB: Number(sampleB.speed.toFixed(1)),
        elevationA: sampleA.elevation,
        elevationB: sampleB.elevation,
      };
    });
  }, [driveA, driveB, maximum, targetCount]);
  latestCursorRef.current = cursorValue;
  const activeElapsed = hoverElapsed ?? Math.min(maximum, Math.max(0, cursorValue));
  const readoutElapsed = hoverElapsed
    ?? Math.min(maximum, Math.max(0, playing ? autoReadoutElapsed ?? cursorValue : cursorValue));
  const xTicks = useMemo(() => calculateNiceTicks(0, maximum, "time", 8), [maximum]);
  const speedConfig = useMemo(
    () => calculateNiceYTicks(0, Math.max(1, ...data.flatMap((point) => [point.speedA, point.speedB])), 7),
    [data],
  );
  const elevations = useMemo(
    () => data.flatMap((point) => [point.elevationA, point.elevationB].filter((value): value is number => value != null)),
    [data],
  );
  const elevationConfig = useMemo(() => {
    if (!elevations.length) return calculateNiceYTicks(0, 100, 3);
    const minimum = Math.min(...elevations);
    const maximumElevation = Math.max(...elevations);
    const padding = Math.max(5, (maximumElevation - minimum) * 0.05);
    return calculateNiceYTicks(minimum - padding, maximumElevation + padding, 3);
  }, [elevations]);
  const handleMove = (state: TimelineMouseState) => {
    const elapsed = state.activePayload?.[0]?.payload?.elapsed;
    if (typeof elapsed !== "number") return;
    setHoverElapsed(elapsed);
    onCursor(elapsed);
  };

  useEffect(() => {
    if (!playing) {
      setAutoReadoutElapsed(null);
      return;
    }
    setAutoReadoutElapsed(latestCursorRef.current);
    const timer = setInterval(() => {
      setAutoReadoutElapsed(latestCursorRef.current);
    }, READOUT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/50 bg-muted/30 px-2 py-1 text-sm">
        <TimelineReadout elapsed={readoutElapsed} driveA={driveA} driveB={driveB} />
      </div>
      <div className="flex h-[300px] w-full cursor-crosshair select-none flex-col rounded-2xl border border-border bg-card p-3">
        <div className="mb-4 min-h-0 w-full flex-[7]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} onMouseMove={handleMove} onMouseLeave={() => setHoverElapsed(null)}>
              <defs>
                <linearGradient id="wholeDriveSpeedA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.42} /><stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0} /></linearGradient>
                <linearGradient id="wholeDriveSpeedB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--foreground))" stopOpacity={0.18} /><stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0} /></linearGradient>
              </defs>
              <ComparisonGrid xTicks={xTicks} yTicks={speedConfig.ticks} />
              <XAxis dataKey="elapsed" type="number" domain={[0, maximum]} ticks={xTicks} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={formatTimeAxis} minTickGap={12} allowDataOverflow />
              <YAxis domain={speedConfig.domain} ticks={speedConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} width={60} tickFormatter={(value) => Math.round(value).toString()} label={{ value: "Speed (km/h)", angle: -90, position: "insideLeft", ...chartAxisLabel }} />
              <Area type="monotone" dataKey="speedA" name={driveA.activity.title} stroke="hsl(var(--segment-drive-1))" strokeWidth={isMobile ? 1 : 1.5} fill="url(#wholeDriveSpeedA)" dot={false} activeDot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="speedB" name={driveB.activity.title} stroke="hsl(var(--segment-drive-2))" strokeWidth={isMobile ? 1 : 1.5} fill="url(#wholeDriveSpeedB)" dot={false} activeDot={false} isAnimationActive={false} />
              <ReferenceLine x={activeElapsed} stroke="hsl(var(--foreground))" isFront />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {elevations.length > 0 && (
          <div className="min-h-0 w-full flex-[2.5]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} onMouseMove={handleMove} onMouseLeave={() => setHoverElapsed(null)}>
                <defs><linearGradient id="wholeDriveElevation" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.4} /><stop offset="95%" stopColor="hsl(0, 0%, 60%)" stopOpacity={0.1} /></linearGradient></defs>
                <ComparisonGrid xTicks={xTicks} yTicks={elevationConfig.ticks} />
                <XAxis dataKey="elapsed" type="number" domain={[0, maximum]} ticks={xTicks} tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={formatTimeAxis} minTickGap={12} allowDataOverflow />
                <YAxis domain={elevationConfig.domain} ticks={elevationConfig.ticks} tick={chartAxisTick} tickLine={false} axisLine={false} width={60} tickFormatter={(value) => Math.round(value).toString()} />
                <Area type="monotone" dataKey="elevationA" name={`${driveA.activity.title} elevation`} stroke="hsl(var(--segment-drive-1))" strokeWidth={1.5} fill="url(#wholeDriveElevation)" dot={false} activeDot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="elevationB" name={`${driveB.activity.title} elevation`} stroke="hsl(var(--segment-drive-2))" strokeWidth={1.5} fill="none" dot={false} activeDot={false} isAnimationActive={false} />
                <ReferenceLine x={activeElapsed} stroke="hsl(var(--foreground))" isFront />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

export function DriveComparisonDistribution({
  driveA,
  driveB,
}: {
  driveA: DriveComparisonTrack;
  driveB: DriveComparisonTrack;
}) {
  const [metric, setMetric] = useState<"time" | "distance">("time");
  const data = useMemo(() => {
    const bucketsA = new Map(driveA.speedDistribution.map((bucket) => [bucket.minSpeed, bucket]));
    const bucketsB = new Map(driveB.speedDistribution.map((bucket) => [bucket.minSpeed, bucket]));
    const speeds = [...new Set([...bucketsA.keys(), ...bucketsB.keys()])].sort((a, b) => a - b);
    return speeds.map((speed) => ({
      range: bucketsA.get(speed)?.range ?? bucketsB.get(speed)?.range ?? `${speed}-${speed + 10}`,
      driveA: metric === "time" ? bucketsA.get(speed)?.time ?? 0 : bucketsA.get(speed)?.distance ?? 0,
      driveB: metric === "time" ? bucketsB.get(speed)?.time ?? 0 : bucketsB.get(speed)?.distance ?? 0,
    }));
  }, [driveA.speedDistribution, driveB.speedDistribution, metric]);
  const yConfig = useMemo(
    () => calculateNiceYTicks(0, Math.max(1, ...data.flatMap((point) => [point.driveA, point.driveB])), 7),
    [data],
  );

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <div className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/50 p-1">
          <Button className="h-7 rounded-full px-3 text-xs" size="sm" variant={metric === "time" ? "default" : "ghost"} onClick={() => setMetric("time")}>Time</Button>
          <Button className="h-7 rounded-full px-3 text-xs" size="sm" variant={metric === "distance" ? "default" : "ghost"} onClick={() => setMetric("distance")}>Distance</Button>
        </div>
      </div>
      <div className="h-[250px]">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 6, left: -12, bottom: 30 }}>
            <defs>
              <linearGradient id="wholeDriveDistA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="wholeDriveDistB" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--foreground))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            {yConfig.ticks.map((value) => (
              <ReferenceLine key={value} y={value} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeOpacity={0.6} />
            ))}
            <XAxis
              dataKey="range"
              tick={chartAxisTick}
              tickLine={false}
              axisLine={false}
              label={{ value: "Speed Range (km/h)", position: "insideBottom", offset: -8, dy: 5, ...chartAxisLabel }}
            />
            <YAxis
              domain={yConfig.domain}
              ticks={yConfig.ticks}
              tick={chartAxisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}${metric === "time" ? "m" : "km"}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                borderRadius: "16px",
                color: "hsl(var(--foreground))",
                fontSize: "12px",
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
              cursor={{ fill: "hsl(var(--muted)/0.2)" }}
              formatter={(value: number) => `${value.toFixed(2)} ${metric === "time" ? "min" : "km"}`}
            />
            <Bar dataKey="driveA" name={driveA.activity.title} fill="url(#wholeDriveDistA)" stroke="hsl(var(--segment-drive-1))" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={40} />
            <Bar dataKey="driveB" name={driveB.activity.title} fill="url(#wholeDriveDistB)" stroke="hsl(var(--segment-drive-2))" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
