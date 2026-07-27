import { supabase } from "@/lib/supabase";
import type { GPXPoint } from "@/utils/gpxParser";
import {
  generatePublicProcessedTrack,
  getPublicProcessedPath,
} from "@/utils/publicActivity";

export async function uploadPublicProcessedArtifact(
  gpxPath: string,
  points: GPXPoint[],
  speedCap?: number | null,
  hideRadius?: number | null,
) {
  const artifact = generatePublicProcessedTrack(points, speedCap, hideRadius);
  const path = getPublicProcessedPath(gpxPath);
  const { error } = await supabase.storage
    .from("gpx-files")
    .upload(path, new Blob([JSON.stringify(artifact)], { type: "application/json" }), {
      upsert: true,
    });

  if (error) throw error;
  return { artifact, path };
}
