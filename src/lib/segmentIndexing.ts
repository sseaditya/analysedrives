import { supabase } from "@/lib/supabase";

type IndexRequest = { activityId: string } | { segmentId: string; force?: boolean };

export type SegmentIndexResult = {
  ok: true;
  skipped?: boolean;
  checked?: number;
  matched?: number;
  failures?: number;
  failureDetails?: string[];
};

export async function indexSegmentEfforts(request: IndexRequest): Promise<SegmentIndexResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You must be signed in to index segment efforts.");

  const response = await fetch("/api/index-segments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; stage?: string } | null;
    const context = payload?.stage ? `${payload.stage}: ` : "";
    throw new Error(`${context}${payload?.error || "Segment indexing failed."}`);
  }

  const payload = await response.json() as SegmentIndexResult;
  // A migrated database can contain stale activity rows whose storage objects
  // no longer exist. Do not throw away successfully persisted matches just
  // because another drive failed to load. Callers can surface the partial
  // failure while still reading the usable leaderboard rows.
  if ((payload.failures ?? 0) > 0 && (payload.matched ?? 0) === 0) {
    const detail = payload.failureDetails?.[0] ? ` ${payload.failureDetails[0]}` : "";
    throw new Error(`Segment indexing skipped ${payload.failures} inaccessible drive${payload.failures === 1 ? "" : "s"}.${detail}`);
  }
  return payload;
}

let backgroundIndexQueue = Promise.resolve();

/**
 * Run expensive storage downloads and alignment outside the user-facing save
 * path. A single queue prevents bulk GPX/Strava imports from starting many
 * server backfills at once.
 */
export function scheduleSegmentEffortIndexing(
  request: IndexRequest,
  onError?: (error: unknown) => void,
) {
  window.setTimeout(() => {
    backgroundIndexQueue = backgroundIndexQueue
      .then(() => indexSegmentEfforts(request))
      .then(() => undefined)
      .catch((error) => {
        onError?.(error);
      });
  }, 0);
}
