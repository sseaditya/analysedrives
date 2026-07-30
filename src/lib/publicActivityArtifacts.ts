import { supabase } from "@/lib/supabase";
import type { GPXPoint } from "@/utils/gpxParser";
import {
  generatePublicProcessedTrack,
  getPublicProcessedPath,
} from "@/utils/publicActivity";

const PUBLIC_ARTIFACT_UPLOAD_ATTEMPTS = 3;

function isTransientStorageError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "StorageUnknownError"
    || /load failed|failed to fetch|network connection|networkerror/i.test(message);
}

function retryDelay(attempt: number) {
  return new Promise((resolve) => window.setTimeout(resolve, 400 * 2 ** attempt));
}

export async function uploadPublicProcessedArtifact(
  gpxPath: string,
  points: GPXPoint[],
  speedCap?: number | null,
  hideRadius?: number | null,
) {
  const artifact = generatePublicProcessedTrack(points, speedCap, hideRadius);
  const path = getPublicProcessedPath(gpxPath);
  const artifactBlob = new Blob([JSON.stringify(artifact)], { type: "application/json" });
  let lastError: unknown = null;

  for (let attempt = 0; attempt < PUBLIC_ARTIFACT_UPLOAD_ATTEMPTS; attempt++) {
    const { error } = await supabase.storage
      .from("gpx-files")
      .upload(path, artifactBlob, {
        upsert: true,
      });

    if (!error) return { artifact, path };
    lastError = error;
    if (!isTransientStorageError(error) || attempt === PUBLIC_ARTIFACT_UPLOAD_ATTEMPTS - 1) {
      throw error;
    }

    await retryDelay(attempt);
  }

  throw lastError;
}
