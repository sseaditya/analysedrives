import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2, Pause, Play, RotateCcw, Route } from "lucide-react";
import { DriveComparisonDistribution, DriveComparisonTimeline } from "@/components/DriveComparisonCharts";
import SegmentsHeader from "@/components/SegmentsHeader";
import WholeDriveComparisonMap from "@/components/WholeDriveComparisonMap";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { fetchActivitySummary, loadActivityTrack } from "@/lib/activityData";
import { buildDriveComparisonTrack, canCompareActivities } from "@/lib/driveComparison";
import { formatDuration } from "@/utils/gpxParser";

const PLAYBACK_DURATION_MS = 30_000;

export default function DriveCompare() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const targetId = params.get("with") ?? "";
  const { user } = useAuth();
  const [cursorValue, setCursorValue] = useState(0);
  const [playing, setPlaying] = useState(false);
  const cursorRef = useRef(0);
  const animationRef = useRef<number | null>(null);

  const sourceQuery = useQuery({
    queryKey: ["drive-comparison-summary", id],
    queryFn: () => fetchActivitySummary(id),
    enabled: Boolean(id && user),
  });
  const targetQuery = useQuery({
    queryKey: ["drive-comparison-summary", targetId],
    queryFn: () => fetchActivitySummary(targetId),
    enabled: Boolean(targetId && user),
  });
  const summariesValid = Boolean(
    user
    && sourceQuery.data
    && targetQuery.data
    && canCompareActivities(sourceQuery.data, targetQuery.data, user.id),
  );
  const tracksQuery = useQuery({
    queryKey: ["whole-drive-comparison-tracks", sourceQuery.data?.id, targetQuery.data?.id, user?.id],
    queryFn: async () => {
      const [source, target] = await Promise.all([
        loadActivityTrack(sourceQuery.data!, user!.id),
        loadActivityTrack(targetQuery.data!, user!.id),
      ]);
      return { source, target };
    },
    enabled: summariesValid,
    staleTime: 5 * 60 * 1000,
  });
  const tracks = useMemo(() => {
    if (!tracksQuery.data || !user) return null;
    const driveA = buildDriveComparisonTrack(tracksQuery.data.source, user.id);
    const driveB = buildDriveComparisonTrack(tracksQuery.data.target, user.id);
    return driveA && driveB ? { driveA, driveB } : null;
  }, [tracksQuery.data, user]);
  const maximum = tracks ? Math.max(tracks.driveA.duration, tracks.driveB.duration) : 0;

  useEffect(() => {
    cursorRef.current = cursorValue;
  }, [cursorValue]);

  useEffect(() => {
    if (!playing || !tracks || maximum <= 0) return;
    let start = Math.min(cursorRef.current, maximum);
    if (start >= maximum) {
      start = 0;
      cursorRef.current = 0;
      setCursorValue(0);
    }
    const remaining = maximum - start;
    const duration = PLAYBACK_DURATION_MS * (remaining / maximum);
    const startedAt = performance.now();
    const renderFrame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(1, duration));
      const next = start + remaining * progress;
      cursorRef.current = next;
      setCursorValue(next);
      if (progress >= 1) {
        animationRef.current = null;
        setPlaying(false);
        return;
      }
      animationRef.current = requestAnimationFrame(renderFrame);
    };
    animationRef.current = requestAnimationFrame(renderFrame);
    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [maximum, playing, tracks]);

  const loading = sourceQuery.isLoading || targetQuery.isLoading || (summariesValid && tracksQuery.isLoading);
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Route className="mx-auto h-8 w-8 animate-pulse text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Preparing both drive timelines…</p>
        </div>
      </div>
    );
  }

  const unavailable = !targetId
    || sourceQuery.isError
    || targetQuery.isError
    || !summariesValid
    || tracksQuery.isError
    || !tracks;
  if (unavailable) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <Route className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-bold">Comparison unavailable</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Start from one of your own drives and choose a different public or user-owned drive.
          </p>
          <Button className="mt-4" asChild><a href={`/activity/${id}`}>Back to drive</a></Button>
        </div>
      </div>
    );
  }

  const { driveA, driveB } = tracks;
  const timeDifference = Math.abs(driveA.duration - driveB.duration);
  const stopPlaybackAt = (value: number) => {
    cursorRef.current = value;
    setCursorValue(value);
    setPlaying(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <SegmentsHeader backTo={`/activity/${id}`} title="Drive comparison" />
      <main className="container mx-auto max-w-7xl space-y-6 px-4 py-8">
        <div>
          <p className="text-sm font-semibold text-primary">Whole-drive time comparison</p>
          <h1 className="text-3xl font-bold">
            {driveA.activity.title} <span className="text-muted-foreground">vs</span> {driveB.activity.title}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Both drives use the same elapsed-time clock. Their routes do not need to overlap.
          </p>
        </div>

        {(driveA.legacyVisibleOnly || driveB.legacyVisibleOnly) && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            An older public drive is shown using its available privacy-safe route and timeline.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Distance" a={`${driveA.distance.toFixed(1)} km`} b={`${driveB.distance.toFixed(1)} km`} />
          <Stat label="Elapsed time" a={formatDuration(driveA.duration)} b={formatDuration(driveB.duration)} />
          <Stat label="Average speed" a={`${driveA.averageSpeed.toFixed(1)} km/h`} b={`${driveB.averageSpeed.toFixed(1)} km/h`} />
          <Stat label="Maximum speed" a={`${driveA.maximumSpeed.toFixed(0)} km/h`} b={`${driveB.maximumSpeed.toFixed(0)} km/h`} />
          <Stat label="Time difference" a={formatDuration(timeDifference)} />
        </div>

        <section className="rounded-2xl border bg-card p-3">
          <WholeDriveComparisonMap driveA={driveA} driveB={driveB} cursorValue={cursorValue} />
          <div className="mt-4 flex items-center gap-3">
            <Button size="icon" variant="outline" aria-label="Reset comparison" onClick={() => stopPlaybackAt(0)}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button size="icon" aria-label={playing ? "Pause comparison" : "Play comparison"} onClick={() => setPlaying((value) => !value)}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <div className="min-w-0 flex-1">
              <Slider min={0} max={maximum} step={1} value={[Math.min(cursorValue, maximum)]} onValueChange={([value]) => stopPlaybackAt(value)} />
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                <span>0:00</span>
                <span>{formatDuration(maximum)}</span>
              </div>
            </div>
            <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{formatDuration(cursorValue)}</span>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="mb-2 text-xl font-bold">Speed and elevation</h2>
          <DriveComparisonTimeline
            driveA={driveA}
            driveB={driveB}
            cursorValue={cursorValue}
            playing={playing}
            onCursor={stopPlaybackAt}
          />
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-xl font-bold">Speed distribution</h2>
          <p className="text-sm text-muted-foreground">Absolute minutes or kilometres within each speed range.</p>
          <DriveComparisonDistribution driveA={driveA} driveB={driveB} />
        </section>
      </main>
    </div>
  );
}

function Stat({ label, a, b }: { label: string; a: string; b?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 font-bold tabular-nums text-[hsl(var(--segment-drive-1))]">{a}</p>
      {b && <p className="mt-1 font-bold tabular-nums text-[hsl(var(--segment-drive-2))]">{b}</p>}
    </div>
  );
}
