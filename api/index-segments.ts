/* eslint-disable @typescript-eslint/no-explicit-any */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import type { ActivitySummary, LoadedActivity, Segment } from "../src/types/segments";
import {
  coarseSegmentCandidate,
  matchActivityToSegment,
  SEGMENT_EFFORT_ALGORITHM_VERSION,
} from "../src/utils/segmentMatching";
import {
  generateProcessedTrack,
  PROCESSED_TRACK_VERSION,
  type GPXPoint,
  type ProcessedTrack,
} from "../src/utils/gpxParser";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_VIEWER_ID = "00000000-0000-0000-0000-000000000000";

const ACTIVITY_SELECT = "id, slug, user_id, title, file_path, created_at, public, speed_cap, hide_radius, stats";

function bearerToken(header?: string | string[]) {
  if (Array.isArray(header) || !header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function hydrateProcessedTrack(activity: ActivitySummary, track: ProcessedTrack): LoadedActivity {
  return {
    activity,
    processedTrack: track,
    points: track.points.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      time: point.time ? new Date(point.time) : undefined,
    })),
  };
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseServerGPX(xml: string): GPXPoint[] {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  const tracks = arrayOf(parsed?.gpx?.trk);
  const points: GPXPoint[] = [];
  for (const track of tracks) {
    for (const segment of arrayOf(track?.trkseg)) {
      for (const point of arrayOf(segment?.trkpt)) {
        const lat = Number(point?.["@_lat"]);
        const lon = Number(point?.["@_lon"]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const ele = Number(point?.ele);
        const time = point?.time ? new Date(point.time) : undefined;
        points.push({
          lat,
          lon,
          ele: Number.isFinite(ele) ? ele : undefined,
          time: time && !Number.isNaN(time.getTime()) ? time : undefined,
        });
      }
    }
  }
  return points;
}

async function loadActivity(admin: any, activity: ActivitySummary): Promise<LoadedActivity> {
  const processedPath = activity.file_path.replace(/\.gpx$/i, "") + ".processed.json";
  const { data: processedBlob, error: processedError } = await admin.storage.from("gpx-files").download(processedPath);
  if (!processedError && processedBlob) {
    try {
      const track = JSON.parse(await processedBlob.text()) as ProcessedTrack;
      if (track.version === PROCESSED_TRACK_VERSION && Array.isArray(track.points) && track.points.length >= 2) {
        return hydrateProcessedTrack(activity, track);
      }
    } catch (error) {
      console.warn("Invalid processed track during segment indexing", activity.id, error);
    }
  }

  const { data: gpxBlob, error: gpxError } = await admin.storage.from("gpx-files").download(activity.file_path);
  if (gpxError || !gpxBlob) throw gpxError || new Error("Activity GPX is unavailable");
  const points = parseServerGPX(await gpxBlob.text());
  if (points.length < 2) throw new Error("Activity does not contain enough GPS points");
  return { activity, points, processedTrack: generateProcessedTrack(points) };
}

function effortValues(segment: Segment, loaded: LoadedActivity) {
  const raw = matchActivityToSegment(segment, loaded, loaded.activity.user_id);
  if (!raw) return null;
  const publicMatch = loaded.activity.public
    ? matchActivityToSegment(segment, loaded, PUBLIC_VIEWER_ID)
    : null;
  return {
    segment_id: segment.id,
    activity_id: loaded.activity.id,
    activity_user_id: loaded.activity.user_id,
    raw_score: raw.score,
    raw_coverage: raw.coverage,
    raw_matched_distance: raw.matchedDistance,
    raw_elapsed_time: raw.elapsedTime,
    raw_avg_speed: raw.avgSpeed,
    raw_max_speed: raw.maxSpeed,
    raw_alignment: raw.alignment,
    public_score: publicMatch?.score ?? null,
    public_coverage: publicMatch?.coverage ?? null,
    public_matched_distance: publicMatch?.matchedDistance ?? null,
    public_elapsed_time: publicMatch?.elapsedTime ?? null,
    public_avg_speed: publicMatch?.avgSpeed ?? null,
    public_max_speed: publicMatch?.maxSpeed ?? null,
    public_alignment: publicMatch?.alignment ?? null,
    algorithm_version: SEGMENT_EFFORT_ALGORITHM_VERSION,
    indexed_at: new Date().toISOString(),
  };
}

async function indexPair(admin: any, segment: Segment, loaded: LoadedActivity) {
  const candidate = coarseSegmentCandidate(segment, loaded.activity);
  const values = candidate ? effortValues(segment, loaded) : null;
  if (!values) {
    await removePair(admin, segment.id, loaded.activity.id);
    return false;
  }
  const { error } = await admin.from("segment_efforts").upsert(values, { onConflict: "segment_id,activity_id" });
  if (error) throw error;
  return true;
}

async function removePair(admin: any, segmentId: string, activityId: string) {
  const { error } = await admin.from("segment_efforts").delete()
    .eq("segment_id", segmentId).eq("activity_id", activityId);
  if (error) throw error;
}

async function indexActivity(admin: any, activity: ActivitySummary) {
  const { data, error } = await admin.from("segments").select("*");
  if (error) throw error;
  const loaded = await loadActivity(admin, activity);
  let matched = 0;
  let failures = 0;
  for (const segment of (data || []) as Segment[]) {
    try {
      if (await indexPair(admin, segment, loaded)) matched++;
    } catch (error) {
      failures++;
      console.error("Could not index activity against segment", activity.id, segment.id, error);
    }
  }
  return { checked: data?.length || 0, matched, failures };
}

async function indexSegment(admin: any, segment: Segment) {
  const { data, error } = await admin.from("activities").select(ACTIVITY_SELECT);
  if (error) throw error;
  let matched = 0;
  let failures = 0;
  const activities = (data || []) as ActivitySummary[];
  const concurrency = 4;
  for (let offset = 0; offset < activities.length; offset += concurrency) {
    const results = await Promise.allSettled(activities.slice(offset, offset + concurrency).map(async (activity) => {
      if (!coarseSegmentCandidate(segment, activity)) {
        await removePair(admin, segment.id, activity.id);
        return false;
      }
      return indexPair(admin, segment, await loadActivity(admin, activity));
    }));
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value) matched++;
      } else {
        failures++;
        console.error("Could not index segment activity", segment.id, result.reason);
      }
    }
  }
  if (failures === 0) {
    const { error: updateError } = await admin.from("segments").update({
      efforts_algorithm_version: SEGMENT_EFFORT_ALGORITHM_VERSION,
      efforts_indexed_at: new Date().toISOString(),
    }).eq("id", segment.id);
    if (updateError) throw updateError;
  }
  return { checked: activities.length, matched, failures };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }
  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "Missing authorization token" });

  const auth = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: "Invalid authorization token" });

  try {
    const activityId = typeof req.body?.activityId === "string" ? req.body.activityId : null;
    const segmentId = typeof req.body?.segmentId === "string" ? req.body.segmentId : null;
    if ((activityId ? 1 : 0) + (segmentId ? 1 : 0) !== 1) {
      return res.status(400).json({ error: "Provide exactly one activityId or segmentId" });
    }

    if (activityId) {
      const { data, error } = await admin.from("activities").select(ACTIVITY_SELECT).eq("id", activityId).single();
      if (error || !data) return res.status(404).json({ error: "Activity not found" });
      const activity = data as ActivitySummary;
      if (activity.user_id !== authData.user.id) return res.status(403).json({ error: "Not allowed to index this activity" });
      return res.status(200).json({ ok: true, ...(await indexActivity(admin, activity)) });
    }

    const { data, error } = await admin.from("segments").select("*").eq("id", segmentId!).single();
    if (error || !data) return res.status(404).json({ error: "Segment not found" });
    const segment = data as Segment;
    const force = req.body?.force === true;
    if (!force && (segment.efforts_algorithm_version || 0) >= SEGMENT_EFFORT_ALGORITHM_VERSION) {
      return res.status(200).json({ ok: true, skipped: true });
    }
    return res.status(200).json({ ok: true, ...(await indexSegment(admin, segment)) });
  } catch (error) {
    console.error("Segment indexing failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Segment indexing failed" });
  }
}
