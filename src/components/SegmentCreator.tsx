import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Route, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import TrackMap from "@/components/TrackMap";
import { supabase } from "@/lib/supabase";
import { indexSegmentEfforts } from "@/lib/segmentIndexing";
import { cumulativeDistances, extractSegmentGeometry, privacyVisibleRange, segmentBounds } from "@/utils/segmentMatching";
import type { GPXPoint } from "@/utils/gpxParser";

interface SegmentCreatorProps {
  activityId: string;
  activityTitle: string;
  points: GPXPoint[];
  hideRadius: number;
  stopPoints?: [number, number][];
  tightTurnPoints?: [number, number][];
  hairpinPoints?: [number, number][];
}

export default function SegmentCreator({
  activityId,
  activityTitle,
  points,
  hideRadius,
  stopPoints,
  tightTurnPoints,
  hairpinPoints,
}: SegmentCreatorProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const distances = useMemo(() => cumulativeDistances(points), [points]);
  const visibleRange = useMemo(() => privacyVisibleRange(points, hideRadius), [points, hideRadius]);
  const [range, setRange] = useState<[number, number]>(visibleRange);

  useEffect(() => setRange(visibleRange), [visibleRange]);

  const selectedDistance = Math.max(0, (distances[range[1]] ?? 0) - (distances[range[0]] ?? 0));
  const visibleDistance = Math.max(0, (distances[visibleRange[1]] ?? 0) - (distances[visibleRange[0]] ?? 0));
  const toIndex = (distance: number) => {
    let low = visibleRange[0];
    let high = visibleRange[1];
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (distances[middle] < distance) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const handleRange = (values: number[]) => {
    const next: [number, number] = [toIndex(values[0]), toIndex(values[1])];
    if (next[1] > next[0]) setRange(next);
  };

  const save = async () => {
    if (name.trim().length < 2) return toast.error("Give the segment a name.");
    if (selectedDistance < 0.5) return toast.error("Select at least 500 metres of road.");
    const geometry = extractSegmentGeometry(points, range[0], range[1]);
    if (geometry.length < 2) return toast.error("The selected range is too short.");
    setSaving(true);
    const { data, error } = await supabase.from("segments").insert({
      name: name.trim(),
      description: description.trim() || null,
      source_activity_id: activityId,
      source_title: activityTitle,
      geometry,
      distance_km: geometry[geometry.length - 1].distance,
      bounds: segmentBounds(geometry),
      created_by: (await supabase.auth.getUser()).data.user?.id,
    }).select("id").single();
    if (error) {
      setSaving(false);
      console.error(error);
      toast.error("Could not publish the segment. Apply the segment database migration first if needed.");
      return;
    }
    try {
      await indexSegmentEfforts({ segmentId: data.id, force: true });
    } catch (indexError) {
      console.warn("Segment created, but its initial effort backfill did not finish", indexError);
      toast.warning("Segment created. Existing drives will be indexed when the leaderboard opens.");
    }
    setSaving(false);
    toast.success("Public comparison segment created.");
    setOpen(false);
    navigate(`/segments/${data.id}`);
  };

  if (visibleRange[1] <= visibleRange[0]) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Route className="h-4 w-4" />
          <span className="hidden md:inline">Create segment</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a public comparison segment</DialogTitle>
          <DialogDescription>Select the shared road section. Hidden start/end privacy zones cannot be published.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <TrackMap
            points={points}
            zoomRange={range}
            stopPoints={stopPoints}
            tightTurnPoints={tightTurnPoints}
            hairpinPoints={hairpinPoints}
            privacyMask={{ start: visibleRange[0], end: visibleRange[1] }}
            preserveViewportOnRangeChange
          />
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex justify-between text-sm">
              <span>Selected road</span>
              <span className="font-semibold tabular-nums">{selectedDistance.toFixed(1)} km</span>
            </div>
            <Slider
              min={distances[visibleRange[0]]}
              max={distances[visibleRange[1]]}
              step={Math.max(0.05, visibleDistance / 1000)}
              value={[distances[range[0]], distances[range[1]]]}
              onValueChange={handleRange}
            />
            <p className="text-xs text-muted-foreground">Drag either handle; the highlighted map section is what becomes public.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="segment-name">Segment name</Label>
              <Input id="segment-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Mumbai–Pune Expressway" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="segment-description">Description (optional)</Label>
              <Textarea id="segment-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Direction, landmarks, or notes" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || selectedDistance < 0.5}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Publish segment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
