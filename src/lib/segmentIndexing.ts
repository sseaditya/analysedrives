import { supabase } from "@/lib/supabase";

type IndexRequest = { activityId: string } | { segmentId: string; force?: boolean };

export async function indexSegmentEfforts(request: IndexRequest): Promise<void> {
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
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "Segment indexing failed.");
  }
}
