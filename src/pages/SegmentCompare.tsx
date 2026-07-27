import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Info, Pause, Play, RotateCcw, Route } from "lucide-react";
import ComparisonMap from "@/components/ComparisonMap";
import { ComparisonDistribution, ComparisonTimeline } from "@/components/ComparisonCharts";
import SegmentsHeader from "@/components/SegmentsHeader";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { fetchSegment, findRejectedSegmentMatches, findSegmentMatches, loadLeaderboardMatch } from "@/lib/segmentData";
import { buildComparisonSeries, comparisonAverageSpeed, SEGMENT_EFFORT_ALGORITHM_VERSION } from "@/utils/segmentMatching";
import { formatDuration } from "@/utils/gpxParser";

const AUTO_PLAYBACK_DURATION_MS = 30_000;
const AUTO_PLAYBACK_FPS = 60;

export default function SegmentCompare() {
  const { segmentId = "" } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [comparisonMode, setComparisonMode] = useState<"time" | "distance">("time");
  const [cursorValue, setCursorValue] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackFrameStep, setPlaybackFrameStep] = useState(0);
  const [speedInfoOpen, setSpeedInfoOpen] = useState(false);
  const playbackFrameRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const cursorStartRef = useRef(0);
  const cursorRef = useRef(0);
  const segmentQuery = useQuery({ queryKey: ["segment", segmentId], queryFn: () => fetchSegment(segmentId), enabled: !!segmentId });
  const driveIds = [params.get("driveA"), params.get("driveB")].filter((id): id is string => Boolean(id));
  const matchesQuery = useQuery({
    queryKey: ["segment-comparison-matches", segmentId, user?.id, SEGMENT_EFFORT_ALGORITHM_VERSION, ...driveIds],
    queryFn: async () => {
      const leaderboard = await findSegmentMatches(segmentQuery.data!, user!.id);
      const selected = leaderboard.matches.filter((match) => driveIds.includes(match.activity.id));
      if (selected.length < driveIds.length) {
        const rejected = await findRejectedSegmentMatches(
          segmentQuery.data!,
          user!.id,
          leaderboard.matches.map((match) => match.activity.id),
          driveIds,
        );
        selected.push(...rejected.flatMap((entry) => entry.candidate ? [entry.candidate] : []));
      }
      return Promise.all(selected.map((entry) => loadLeaderboardMatch(entry, user!.id)));
    },
    enabled: !!segmentQuery.data && !!user && driveIds.length === 2,
    staleTime: 5 * 60 * 1000,
  });
  const matchA = matchesQuery.data?.find((match) => match.activity.id === params.get("driveA"));
  const matchB = matchesQuery.data?.find((match) => match.activity.id === params.get("driveB"));
  const series = useMemo(() => segmentQuery.data && matchA && matchB && user ? buildComparisonSeries(segmentQuery.data, matchA, matchB, user.id) : null, [segmentQuery.data, matchA, matchB, user]);

  useEffect(() => { cursorRef.current = cursorValue; }, [cursorValue]);

  useEffect(() => {
    if (!playing || !series) return;
    startedRef.current = performance.now();
    cursorStartRef.current = cursorRef.current;
    const last = series.points[series.points.length - 1];
    const maximum = comparisonMode === "time" ? Math.max(last.elapsedA, last.elapsedB) : series.distance;
    const remaining = Math.max(0.001, maximum - cursorStartRef.current);
    setPlaybackFrameStep(remaining / (AUTO_PLAYBACK_FPS * AUTO_PLAYBACK_DURATION_MS / 1000));
    const advancePlayback = () => {
      const now = performance.now();
      const rawAdvance = ((now - startedRef.current) / AUTO_PLAYBACK_DURATION_MS) * remaining;
      const next = cursorStartRef.current + rawAdvance;
      if (next >= maximum) { setCursorValue(maximum); setPlaying(false); return; }
      setCursorValue(next);
      playbackFrameRef.current = requestAnimationFrame(advancePlayback);
    };
    playbackFrameRef.current = requestAnimationFrame(advancePlayback);
    return () => {
      if (playbackFrameRef.current != null) cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    };
  }, [comparisonMode, playing, series]);

  if (segmentQuery.isLoading || matchesQuery.isLoading) return <div className="flex min-h-screen items-center justify-center"><div className="text-center"><Route className="mx-auto h-8 w-8 animate-pulse text-primary" /><p className="mt-3 text-sm text-muted-foreground">Aligning selected drives…</p></div></div>;
  if (!segmentQuery.data || !matchA || !matchB || !series) return <div className="flex min-h-screen items-center justify-center text-center"><div><h1 className="text-xl font-bold">Comparison unavailable</h1><p className="mt-2 text-sm text-muted-foreground">Choose two accessible qualifying drives from the leaderboard.</p><Button className="mt-4" onClick={() => navigate(`/segments/${segmentId}`)}>Back to leaderboard</Button></div></div>;
  const last = series.points[series.points.length - 1];
  // Average speed is derived from the original elapsed time, then hidden at
  // the public cap. The cap must not manufacture a slower comparison time.
  const avgA = comparisonAverageSpeed(series.distance, last.elapsedA, matchA, user.id);
  const avgB = comparisonAverageSpeed(series.distance, last.elapsedB, matchB, user.id);
  const maxA = Math.max(...series.points.map((point) => point.speedA));
  const maxB = Math.max(...series.points.map((point) => point.speedB));
  const comparisonDuration = Math.max(last.elapsedA, last.elapsedB);
  const cursorTimes = comparisonMode === "time"
    ? [cursorValue, cursorValue] as const
    : [valueAtDistance(series, cursorValue, "elapsedA"), valueAtDistance(series, cursorValue, "elapsedB")] as const;

  const changeMode = (mode: "time" | "distance") => {
    if (mode === comparisonMode) return;
    const nextValue = mode === "distance"
      ? (valueAtElapsed(series, cursorValue, "A", "distance") + valueAtElapsed(series, cursorValue, "B", "distance")) / 2
      : (valueAtDistance(series, cursorValue, "elapsedA") + valueAtDistance(series, cursorValue, "elapsedB")) / 2;
    setComparisonMode(mode);
    setCursorValue(nextValue);
    setPlaying(false);
  };

  return <div className="min-h-screen bg-background"><SegmentsHeader backTo={`/segments/${segmentId}`} title="Drive comparison" /><main className="container mx-auto max-w-7xl space-y-6 px-4 py-8">
    <div><p className="text-sm font-semibold text-primary">{segmentQuery.data.name}</p><h1 className="text-3xl font-bold">{matchA.activity.title} <span className="text-muted-foreground">vs</span> {matchB.activity.title}</h1><p className="mt-1 text-muted-foreground">Only the longest road section covered by both drives is compared.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat label="Common distance" a={`${series.distance.toFixed(1)} km`} /><Stat label="Elapsed time" a={formatDuration(last.elapsedA)} b={formatDuration(last.elapsedB)} /><Stat label="Average speed" a={`${avgA.toFixed(1)} km/h`} b={`${avgB.toFixed(1)} km/h`} /><Stat label="Maximum speed" a={`${maxA.toFixed(0)} km/h`} b={`${maxB.toFixed(0)} km/h`} /><Stat label="Time difference" a={formatDuration(Math.abs(last.elapsedA - last.elapsedB))} /></div>
    <section className="rounded-2xl border bg-card p-3"><ComparisonMap segment={segmentQuery.data} series={series} cursorMode={comparisonMode} cursorValue={cursorValue} driveATitle={matchA.activity.title} driveBTitle={matchB.activity.title} /><div className="mt-4 flex items-center gap-3"><Button size="icon" variant="outline" onClick={() => { setCursorValue(0); setPlaying(false); }}><RotateCcw className="h-4 w-4" /></Button><Button size="icon" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button><TimeStrip mode={comparisonMode} duration={comparisonDuration} times={cursorTimes} value={cursorValue} onChange={(value) => { setCursorValue(value); setPlaying(false); }} /><span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{comparisonMode === "time" ? formatDuration(cursorValue) : `${cursorValue.toFixed(1)} km`}</span></div></section>
    <section className="rounded-2xl border bg-card p-4"><h2 className="mb-2 flex items-center gap-2 text-xl font-bold">Speed and elevation<Popover open={speedInfoOpen} onOpenChange={setSpeedInfoOpen}><PopoverTrigger asChild><button type="button" className="focus:outline-none" aria-label="More Information" onMouseEnter={() => setSpeedInfoOpen(true)} onMouseLeave={() => setSpeedInfoOpen(false)} onFocus={() => setSpeedInfoOpen(true)} onBlur={() => setSpeedInfoOpen(false)}><Info className="h-4 w-4 cursor-help text-muted-foreground hover:text-foreground" /></button></PopoverTrigger><PopoverContent className="max-w-xs text-xs z-[1100]"><p>Time compares both drives at the same moment; distance compares them at the same point on the route.</p></PopoverContent></Popover></h2><ComparisonTimeline series={series} matchA={matchA} matchB={matchB} mode={comparisonMode} playing={playing} playbackFrameStep={playbackFrameStep} cursorValue={cursorValue} onModeChange={changeMode} onCursor={(value) => { setCursorValue(value); setPlaying(false); }} /></section>
    <section className="rounded-2xl border bg-card p-4"><h2 className="text-xl font-bold">Speed distribution</h2><p className="text-sm text-muted-foreground">Absolute minutes or kilometres within each speed range.</p><ComparisonDistribution series={series} matchA={matchA} matchB={matchB} viewerId={user.id} /></section>
  </main></div>;
}

function valueAtDistance(series: NonNullable<ReturnType<typeof buildComparisonSeries>>, distance: number, key: "elapsedA" | "elapsedB") {
  const points = series.points;
  if (distance <= 0) return 0;
  if (distance >= series.distance) return points.at(-1)![key];
  let right = points.findIndex((point) => point.distance >= distance);
  if (right <= 0) right = 1;
  const left = right - 1;
  const span = points[right].distance - points[left].distance;
  const ratio = span > 0 ? (distance - points[left].distance) / span : 0;
  return points[left][key] + (points[right][key] - points[left][key]) * ratio;
}

function valueAtElapsed(series: NonNullable<ReturnType<typeof buildComparisonSeries>>, elapsed: number, side: "A" | "B", output: "distance") {
  const key = side === "A" ? "elapsedA" : "elapsedB";
  const points = series.points;
  if (elapsed <= 0) return 0;
  if (elapsed >= points.at(-1)![key]) return series.distance;
  let right = points.findIndex((point) => point[key] >= elapsed);
  if (right <= 0) right = 1;
  const left = right - 1;
  const span = points[right][key] - points[left][key];
  const ratio = span > 0 ? (elapsed - points[left][key]) / span : 0;
  return output === "distance" ? points[left].distance + (points[right].distance - points[left].distance) * ratio : 0;
}

function TimeStrip({ mode, duration, times, value, onChange }: { mode: "time" | "distance"; duration: number; times: readonly [number, number]; value: number; onChange: (value: number) => void }) {
  if (mode === "time") return <div className="min-w-0 flex-1"><Slider min={0} max={duration} step={1} value={[Math.min(value, duration)]} onValueChange={([next]) => onChange(next)} /><div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>0:00</span><span>{formatDuration(duration)}</span></div></div>;
  return <div className="min-w-0 flex-1">
    <div className="relative mt-1 h-3 rounded-full bg-muted">
      <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-[hsl(var(--segment-drive-1))] shadow" style={{ left: `${Math.min(100, times[0] / Math.max(1, duration) * 100)}%` }} />
      <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-[hsl(var(--segment-drive-2))] shadow" style={{ left: `${Math.min(100, times[1] / Math.max(1, duration) * 100)}%` }} />
    </div>
    <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span className="flex gap-2"><i className="text-[hsl(var(--segment-drive-1))] not-italic">{formatDuration(times[0])}</i><i className="text-[hsl(var(--segment-drive-2))] not-italic">{formatDuration(times[1])}</i></span><span>{formatDuration(duration)}</span></div>
  </div>;
}

function Stat({ label, a, b }: { label: string; a: string; b?: string }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 font-bold tabular-nums text-[hsl(var(--segment-drive-1))]">{a}</p>{b && <p className="mt-1 font-bold tabular-nums text-[hsl(var(--segment-drive-2))]">{b}</p>}</div>; }
