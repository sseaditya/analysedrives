import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Clock, Globe, Loader2, Lock, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAccessibleActivities } from "@/lib/activityData";
import { cn } from "@/lib/utils";
import type { ActivitySummary } from "@/types/segments";
import { formatDistance, formatDurationShort } from "@/utils/gpxParser";

export default function DriveCompareDialog({
  currentActivityId,
  open,
  onOpenChange,
}: {
  currentActivityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["accessible-drive-comparison-options", user?.id],
    queryFn: () => fetchAccessibleActivities(user!.id),
    enabled: open && Boolean(user),
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedId(null);
  }, [open]);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const available = (query.data ?? []).filter((activity) => {
      if (activity.id === currentActivityId) return false;
      if (!needle) return true;
      const owner = activity.profiles?.display_name || activity.profiles?.full_name || "";
      return `${activity.title} ${owner} ${activity.profiles?.car ?? ""}`.toLowerCase().includes(needle);
    });
    return {
      mine: available.filter((activity) => activity.user_id === user?.id),
      publicDrives: available.filter((activity) => activity.user_id !== user?.id && activity.public),
    };
  }, [currentActivityId, query.data, search, user?.id]);
  const resultCount = groups.mine.length + groups.publicDrives.length;

  const compare = () => {
    if (!selectedId) return;
    onOpenChange(false);
    navigate(`/activity/${currentActivityId}/compare?with=${encodeURIComponent(selectedId)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Compare this drive</DialogTitle>
          <DialogDescription>
            Choose one of your other drives or a public drive. Routes do not need to overlap.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search drives, drivers, or cars"
            className="pl-9"
            aria-label="Search drives"
          />
        </div>

        <ScrollArea className="min-h-0 flex-1 pr-3">
          {query.isLoading ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Loading accessible drives…</p>
            </div>
          ) : query.isError ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p className="font-semibold">Could not load drives</p>
              <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
              <Button className="mt-4" variant="outline" onClick={() => query.refetch()}>Retry</Button>
            </div>
          ) : resultCount === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
              <Search className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">{search ? "No matching drives" : "No other accessible drives"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {search ? "Try a different search." : "Upload another drive or check the public feed later."}
              </p>
            </div>
          ) : (
            <div className="space-y-6 py-1">
              <DriveGroup
                title="My drives"
                activities={groups.mine}
                selectedId={selectedId}
                onSelect={setSelectedId}
                userId={user?.id ?? ""}
              />
              <DriveGroup
                title="Public drives"
                activities={groups.publicDrives}
                selectedId={selectedId}
                onSelect={setSelectedId}
                userId={user?.id ?? ""}
              />
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="border-t pt-4 sm:items-center sm:justify-between">
          <p className="text-left text-xs text-muted-foreground">
            {selectedId ? "Ready to compare on one shared time clock." : `${resultCount} drive${resultCount === 1 ? "" : "s"} available`}
          </p>
          <Button disabled={!selectedId || query.isLoading || query.isError} onClick={compare}>Compare drives</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DriveGroup({
  title,
  activities,
  selectedId,
  onSelect,
  userId,
}: {
  title: string;
  activities: ActivitySummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  userId: string;
}) {
  if (activities.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="text-xs text-muted-foreground">{activities.length}</span>
      </div>
      <div className="space-y-2">
        {activities.map((activity) => {
          const selected = selectedId === activity.id;
          const owner = activity.user_id === userId
            ? "You"
            : activity.profiles?.display_name || activity.profiles?.full_name || "Driver";
          const date = activity.stats?.startTime || activity.created_at;
          return (
            <button
              key={activity.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(activity.id)}
              className={cn(
                "w-full rounded-xl border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5",
                selected && "border-primary bg-primary/10 ring-1 ring-primary",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{activity.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {owner}{activity.profiles?.car ? ` • ${activity.profiles.car}` : ""}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {activity.public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {activity.public ? "Public" : "Private"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(date as string | number | Date).toLocaleDateString()}</span>
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{formatDistance(Number(activity.stats?.totalDistance) || 0)}</span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDurationShort(Number(activity.stats?.totalTime) || 0)}</span>
                <span>{Number(activity.stats?.avgSpeed || 0).toFixed(1)} km/h avg</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
