import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, RotateCcw, Route } from "lucide-react";
import ComparisonMap from "@/components/ComparisonMap";
import { ComparisonDistribution, ComparisonTimeline } from "@/components/ComparisonCharts";
import SegmentsHeader from "@/components/SegmentsHeader";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { fetchSegment, findSegmentMatches } from "@/lib/segmentData";
import { buildComparisonSeries } from "@/utils/segmentMatching";
import { formatDuration } from "@/utils/gpxParser";

export default function SegmentCompare() {
  const { segmentId = "" } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const cursorStartRef = useRef(0);
  const cursorRef = useRef(0);
  const segmentQuery = useQuery({ queryKey: ["segment", segmentId], queryFn: () => fetchSegment(segmentId), enabled: !!segmentId });
  const matchesQuery = useQuery({ queryKey: ["segment-matches", segmentId, user?.id], queryFn: () => findSegmentMatches(segmentQuery.data!, user!.id), enabled: !!segmentQuery.data && !!user, staleTime: 5 * 60 * 1000 });
  const matchA = matchesQuery.data?.matches.find((match) => match.activity.id === params.get("driveA"));
  const matchB = matchesQuery.data?.matches.find((match) => match.activity.id === params.get("driveB"));
  const series = useMemo(() => segmentQuery.data && matchA && matchB && user ? buildComparisonSeries(segmentQuery.data, matchA, matchB, user.id) : null, [segmentQuery.data, matchA, matchB, user]);

  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  useEffect(() => {
    if (!playing || !series) return;
    startedRef.current = performance.now();
    cursorStartRef.current = cursorRef.current;
    const animate = (now: number) => {
      const remaining = Math.max(1, series.points.length - 1 - cursorStartRef.current);
      const advance = Math.floor(((now - startedRef.current) / 30_000) * remaining);
      const next = cursorStartRef.current + advance;
      if (next >= series.points.length - 1) { setCursor(series.points.length - 1); setPlaying(false); return; }
      setCursor(next);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current != null) cancelAnimationFrame(frameRef.current); };
  }, [playing, series]);

  if (segmentQuery.isLoading || matchesQuery.isLoading) return <div className="flex min-h-screen items-center justify-center"><div className="text-center"><Route className="mx-auto h-8 w-8 animate-pulse text-primary" /><p className="mt-3 text-sm text-muted-foreground">Aligning selected drives…</p></div></div>;
  if (!segmentQuery.data || !matchA || !matchB || !series) return <div className="flex min-h-screen items-center justify-center text-center"><div><h1 className="text-xl font-bold">Comparison unavailable</h1><p className="mt-2 text-sm text-muted-foreground">Choose two accessible qualifying drives from the leaderboard.</p><Button className="mt-4" onClick={() => navigate(`/segments/${segmentId}`)}>Back to leaderboard</Button></div></div>;
  const last = series.points[series.points.length - 1];
  const avgA = last.elapsedA > 0 ? series.distance / (last.elapsedA / 3600) : 0;
  const avgB = last.elapsedB > 0 ? series.distance / (last.elapsedB / 3600) : 0;
  const maxA = Math.max(...series.points.map((point) => point.speedA));
  const maxB = Math.max(...series.points.map((point) => point.speedB));

  return <div className="min-h-screen bg-background"><SegmentsHeader backTo={`/segments/${segmentId}`} title="Drive comparison" /><main className="container mx-auto max-w-7xl space-y-6 px-4 py-8">
    <div><p className="text-sm font-semibold text-primary">{segmentQuery.data.name}</p><h1 className="text-3xl font-bold">{matchA.activity.title} <span className="text-muted-foreground">vs</span> {matchB.activity.title}</h1><p className="mt-1 text-muted-foreground">Only the longest road section covered by both drives is compared.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat label="Common distance" a={`${series.distance.toFixed(1)} km`} /><Stat label="Elapsed time" a={formatDuration(last.elapsedA)} b={formatDuration(last.elapsedB)} /><Stat label="Average speed" a={`${avgA.toFixed(1)} km/h`} b={`${avgB.toFixed(1)} km/h`} /><Stat label="Maximum speed" a={`${maxA.toFixed(0)} km/h`} b={`${maxB.toFixed(0)} km/h`} /><Stat label="Time difference" a={formatDuration(Math.abs(last.elapsedA - last.elapsedB))} /></div>
    <section className="rounded-2xl border bg-card p-3"><ComparisonMap segment={segmentQuery.data} series={series} cursor={cursor} /><div className="mt-4 flex items-center gap-3"><Button size="icon" variant="outline" onClick={() => { setCursor(0); setPlaying(false); }}><RotateCcw className="h-4 w-4" /></Button><Button size="icon" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button><Slider min={0} max={series.points.length - 1} step={1} value={[cursor]} onValueChange={([value]) => { setCursor(value); setPlaying(false); }} /><span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{series.points[cursor]?.distance.toFixed(1)} km</span></div></section>
    <section className="rounded-2xl border bg-card p-4"><h2 className="mb-2 text-xl font-bold">Speed and elevation</h2><p className="mb-3 text-sm text-muted-foreground">Hover to place both dots at the same road distance.</p><ComparisonTimeline series={series} matchA={matchA} matchB={matchB} onCursor={(value) => { setCursor(value); setPlaying(false); }} /></section>
    <section className="rounded-2xl border bg-card p-4"><h2 className="text-xl font-bold">Speed distribution</h2><p className="text-sm text-muted-foreground">Absolute minutes or kilometres within each speed range.</p><ComparisonDistribution series={series} matchA={matchA} matchB={matchB} /></section>
  </main></div>;
}

function Stat({ label, a, b }: { label: string; a: string; b?: string }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 font-bold tabular-nums text-orange-500">{a}</p>{b && <p className="mt-1 font-bold tabular-nums text-blue-500">{b}</p>}</div>; }
