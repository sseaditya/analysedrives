import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Car, Check, Clock, Globe, ListFilter, Loader2, Lock, MapPin, Pencil, Plus, Route, Trash2, Trophy, X } from "lucide-react";
import ActivityMiniMap from "@/components/ActivityMiniMap";
import SegmentsHeader from "@/components/SegmentsHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { fetchSegment, findRejectedSegmentMatches, findSegmentMatches } from "@/lib/segmentData";
import { supabase } from "@/lib/supabase";
import { formatDuration } from "@/utils/gpxParser";

export default function SegmentLeaderboard() {
  const { segmentId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [driveA, setDriveA] = useState<string | null>(null);
  const [driveB, setDriveB] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const [includedRejected, setIncludedRejected] = useState<Set<string>>(() => new Set());
  const segmentQuery = useQuery({ queryKey: ["segment", segmentId], queryFn: () => fetchSegment(segmentId), enabled: !!segmentId });
  const matchesQuery = useQuery({
    queryKey: ["segment-matches", segmentId, user?.id],
    queryFn: () => findSegmentMatches(segmentQuery.data!, user!.id),
    enabled: !!segmentQuery.data && !!user,
    staleTime: 5 * 60 * 1000,
  });
  const qualifyingActivityIds = matchesQuery.data?.matches.map((match) => match.activity.id) ?? [];
  const rejectedQuery = useQuery({
    queryKey: ["segment-rejected-matches", segmentId, user?.id],
    queryFn: () => findRejectedSegmentMatches(segmentQuery.data!, user!.id, qualifyingActivityIds),
    enabled: showRejected && !!segmentQuery.data && !!user && matchesQuery.isSuccess,
    staleTime: 5 * 60 * 1000,
  });

  const choose = (side: "a" | "b", id: string) => {
    if (side === "a") {
      setDriveA((current) => current === id ? null : id);
      if (driveB === id) setDriveB(null);
    } else {
      setDriveB((current) => current === id ? null : id);
      if (driveA === id) setDriveA(null);
    }
  };

  if (segmentQuery.isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (segmentQuery.isError || !segmentQuery.data) return <div className="flex min-h-screen items-center justify-center text-center"><div><Route className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-4 text-xl font-bold">Segment unavailable</h1><Button className="mt-4" onClick={() => navigate("/segments")}>Browse segments</Button></div></div>;
  const segment = segmentQuery.data;
  const includedMatches = (rejectedQuery.data ?? [])
    .filter((entry) => includedRejected.has(entry.activity.id) && entry.candidate)
    .map((entry) => entry.candidate!);
  const matches = [...(matchesQuery.data?.matches ?? []), ...includedMatches]
    .sort((a, b) => b.avgSpeed - a.avgSpeed || b.coverage - a.coverage)
    .map((match, index) => ({ ...match, rank: index + 1 }));
  const isCreator = segment.created_by === user?.id;

  const toggleRejected = (id: string) => {
    setIncludedRejected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        if (driveA === id) setDriveA(null);
        if (driveB === id) setDriveB(null);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openEditor = () => { setEditName(segment.name); setEditDescription(segment.description ?? ""); setEditing(true); };
  const saveMetadata = async () => {
    if (editName.trim().length < 2) return;
    const { error } = await supabase.from("segments").update({ name: editName.trim(), description: editDescription.trim() || null }).eq("id", segment.id);
    if (!error) { await queryClient.invalidateQueries({ queryKey: ["segment", segment.id] }); await queryClient.invalidateQueries({ queryKey: ["segments"] }); setEditing(false); }
  };
  const deleteSegment = async () => {
    const { error } = await supabase.from("segments").delete().eq("id", segment.id);
    if (!error) { await queryClient.invalidateQueries({ queryKey: ["segments"] }); navigate("/segments", { replace: true }); }
  };

  return (
    <div className="min-h-screen bg-background">
      <SegmentsHeader backTo="/segments" title={segment.name} />
      <main className="container mx-auto max-w-7xl space-y-6 px-4 py-8">
        <section className="grid overflow-hidden rounded-2xl border bg-card lg:grid-cols-[1.2fr_1fr]">
          <div className="h-64 lg:h-full"><ActivityMiniMap coordinates={segment.geometry.map((point) => [point.lat, point.lon])} /></div>
          <div className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-3"><div><Badge variant="outline">Public segment</Badge><h1 className="mt-3 text-3xl font-bold">{segment.name}</h1><p className="mt-1 text-muted-foreground">Created by {segment.profiles?.display_name || segment.profiles?.full_name || "Driver"}</p></div>{isCreator && <div className="flex gap-1"><Button size="icon" variant="ghost" onClick={openEditor}><Pencil className="h-4 w-4" /></Button><AlertDialog><AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this public segment?</AlertDialogTitle><AlertDialogDescription>The leaderboard link will stop working. Source drives are not affected.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={deleteSegment}>Delete segment</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}</div>
            {segment.description && <p className="text-sm">{segment.description}</p>}
            <div className="flex flex-wrap gap-5 text-sm"><span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-primary" />{segment.distance_km.toFixed(1)} km</span><span>80% minimum coverage</span><span>500 m GPS corridor</span><span>Same direction</span></div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div><div className="flex items-center gap-2"><Trophy className="h-6 w-6 text-amber-500" /><h2 className="text-2xl font-bold">Leaderboard</h2></div><p className="text-sm text-muted-foreground">Ranked by displayed average speed across each matched section.</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShowRejected((value) => !value)}><ListFilter className="mr-2 h-4 w-4" />{showRejected ? "Hide rejected drives" : "Review rejected drives"}</Button><Button disabled={!driveA || !driveB} onClick={() => navigate(`/segments/${segment.id}/compare?driveA=${driveA}&driveB=${driveB}`)}>Compare selected drives</Button></div>
          </div>

          {matchesQuery.isLoading ? <div className="rounded-2xl border p-16 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin" /><p className="mt-3 text-sm text-muted-foreground">Inspecting accessible drive tracks…</p></div> : matchesQuery.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">Could not calculate matches.</div>
          ) : matches.length === 0 ? (
            <div className="space-y-3">
              {(matchesQuery.data?.failures ?? 0) > 0 || matchesQuery.data?.initializationError ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 text-center">
                  <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
                  <h3 className="mt-3 font-semibold">Some drive files could not be checked</h3>
                  <p className="mt-1 text-sm text-muted-foreground">The saved index and live backup were both attempted. Refresh after confirming the migrated GPX files are available.</p>
                  {matchesQuery.data?.initializationError && <p className="mx-auto mt-2 max-w-2xl break-words text-xs text-muted-foreground">{matchesQuery.data.initializationError}</p>}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed p-16 text-center"><Route className="mx-auto h-10 w-10 text-muted-foreground" /><h3 className="mt-3 font-semibold">No qualifying drives yet</h3><p className="text-sm text-muted-foreground">The saved index and live matcher checked accessible drives; none covered at least 80% in the same direction.</p></div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {matchesQuery.data && matchesQuery.data.failures > 0 && <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"><AlertTriangle className="h-4 w-4 text-amber-500" />{matchesQuery.data.failures} inaccessible drive{matchesQuery.data.failures === 1 ? " was" : "s were"} skipped.</div>}
              {matchesQuery.data && !matchesQuery.data.persisted && <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><span>Showing live results because the saved leaderboard could not be updated.{matchesQuery.data.initializationError && <span className="mt-1 block break-words text-xs text-muted-foreground">{matchesQuery.data.initializationError}</span>}</span></div>}
              {matches.map((match, index) => {
                const selectedA = driveA === match.activity.id;
                const selectedB = driveB === match.activity.id;
                return (
                  <div key={match.activity.id} className={`grid gap-4 rounded-xl border bg-card p-4 transition md:grid-cols-[48px_1.5fr_repeat(5,minmax(80px,1fr))_150px] md:items-center ${selectedA || selectedB ? "border-primary shadow-sm" : ""}`}>
                    <div className="text-center text-2xl font-black text-muted-foreground">#{match.rank || index + 1}</div>
                    <div className="min-w-0"><button className="truncate text-left font-bold hover:text-primary" onClick={() => navigate(`/activity/${match.activity.slug || match.activity.id}`)}>{match.activity.title}</button><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{match.activity.profiles?.display_name || match.activity.profiles?.full_name || "Driver"}</span>{match.activity.profiles?.car && <span className="flex items-center gap-1"><Car className="h-3 w-3" />{match.activity.profiles.car}</span>}{match.activity.public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}{includedRejected.has(match.activity.id) && <Badge variant="secondary" className="text-[10px]">Manually included</Badge>}</div></div>
                    <Metric label="Coverage" value={`${(match.coverage * 100).toFixed(0)}%`} />
                    <Metric label="Distance" value={`${match.matchedDistance.toFixed(1)} km`} />
                    <Metric label="Time" value={formatDuration(match.elapsedTime)} icon={<Clock className="h-3 w-3" />} />
                    <Metric label="Avg speed" value={`${match.avgSpeed.toFixed(1)} km/h`} />
                    <Metric label="Max speed" value={`${match.maxSpeed.toFixed(0)} km/h`} />
                    <div className="grid grid-cols-2 gap-2"><Button size="sm" variant={selectedA ? "default" : "outline"} onClick={() => choose("a", match.activity.id)}>{selectedA && <Check className="mr-1 h-3 w-3" />}Drive 1</Button><Button size="sm" variant={selectedB ? "default" : "outline"} onClick={() => choose("b", match.activity.id)}>{selectedB && <Check className="mr-1 h-3 w-3" />}Drive 2</Button></div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {showRejected && <section className="space-y-4 rounded-2xl border bg-card p-5">
          <div><h2 className="text-xl font-bold">Rejected accessible drives</h2><p className="text-sm text-muted-foreground">Public drives and your private drives with 50–79% same-direction coverage. Drives below 50% are not shown. These partial matches can be included for this comparison.</p></div>
          {rejectedQuery.isLoading ? <div className="py-10 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin" /><p className="mt-2 text-sm text-muted-foreground">Checking rejected drives…</p></div> : rejectedQuery.isError ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">Could not inspect rejected drives.</div> : (rejectedQuery.data?.length ?? 0) === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No rejected accessible drives.</div> : <div className="space-y-3">
            {rejectedQuery.data!.map((entry) => {
              const included = includedRejected.has(entry.activity.id);
              const access = entry.activity.public ? (entry.activity.user_id === user?.id ? "Your public drive" : "Public drive") : "Your private drive";
              const explanation = `${((entry.candidate?.coverage ?? 0) * 100).toFixed(0)}% same-direction coverage — below the automatic 80% requirement.`;
              return <div key={entry.activity.id} className={`flex flex-col gap-4 rounded-xl border p-4 md:flex-row md:items-center md:justify-between ${included ? "border-primary bg-primary/5" : ""}`}>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><button className="truncate font-semibold hover:text-primary" onClick={() => navigate(`/activity/${entry.activity.slug || entry.activity.id}`)}>{entry.activity.title}</button><Badge variant="outline">{access}</Badge></div><p className="mt-1 break-words text-sm text-muted-foreground">{explanation}</p></div>
                <Button className="shrink-0" variant={included ? "secondary" : "outline"} disabled={!entry.candidate} onClick={() => toggleRejected(entry.activity.id)}>{included ? <X className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{included ? "Remove" : entry.candidate ? "Include drive" : "Cannot include"}</Button>
              </div>;
            })}
          </div>}
        </section>}
      </main>
      <Dialog open={editing} onOpenChange={setEditing}><DialogContent><DialogHeader><DialogTitle>Edit segment details</DialogTitle></DialogHeader><div className="space-y-3"><Input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={100} /><Textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={500} /></div><DialogFooter><Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button><Button onClick={saveMetadata}>Save</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 flex items-center gap-1 whitespace-nowrap text-sm font-semibold tabular-nums">{icon}{value}</p></div>;
}
