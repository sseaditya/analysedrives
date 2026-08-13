import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Route, Search } from "lucide-react";
import ActivityMiniMap from "@/components/ActivityMiniMap";
import SegmentsHeader from "@/components/SegmentsHeader";
import { Input } from "@/components/ui/input";
import { fetchSegments } from "@/lib/segmentData";

export default function Segments() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["segments"], queryFn: fetchSegments, staleTime: 5 * 60 * 1000 });
  const segments = useMemo(() => (query.data ?? []).filter((segment) => {
    const haystack = `${segment.name} ${segment.description ?? ""} ${segment.source_title}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [query.data, search]);

  return (
    <div className="min-h-screen bg-background">
      <SegmentsHeader backTo="/dashboard" />
      <main className="container mx-auto max-w-7xl space-y-6 px-4 py-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><h1 className="text-3xl font-bold">Public road segments</h1><p className="mt-1 text-muted-foreground">Find a shared road and compare every qualifying drive.</p></div>
          <div className="relative w-full md:w-80"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search segments" /></div>
        </div>
        {query.isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div> : query.isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center"><p className="font-semibold">Could not load road segments</p><p className="mt-2 text-sm text-muted-foreground">Make sure the segment database migration has been applied.</p></div>
        ) : segments.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-16 text-center"><Route className="mx-auto h-10 w-10 text-muted-foreground" /><h2 className="mt-4 font-semibold">No segments found</h2><p className="mt-1 text-sm text-muted-foreground">Open one of your public drives to publish the first one.</p></div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {segments.map((segment) => (
              <button key={segment.id} onClick={() => navigate(`/segments/${segment.id}`)} className="overflow-hidden rounded-2xl border bg-card text-left transition hover:-translate-y-1 hover:shadow-xl">
                <div className="h-48 bg-muted/30"><ActivityMiniMap coordinates={segment.geometry.map((point) => [point.lat, point.lon])} /></div>
                <div className="space-y-3 p-4">
                  <div><h2 className="truncate text-lg font-bold">{segment.name}</h2><p className="text-sm text-muted-foreground">by {segment.profiles?.display_name || segment.profiles?.full_name || "Driver"}</p></div>
                  {segment.description && <p className="line-clamp-2 text-sm text-muted-foreground">{segment.description}</p>}
                  <div className="flex items-center justify-between border-t pt-3 text-sm"><span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-primary" />{segment.distance_km.toFixed(1)} km</span><span className="font-medium text-primary">View leaderboard</span></div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
