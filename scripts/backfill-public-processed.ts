#!/usr/bin/env npx tsx

import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import {
  PROCESSED_TRACK_VERSION,
  type GPXPoint,
  type ProcessedTrack,
} from "../src/utils/gpxParser.js";
import {
  DEFAULT_PUBLIC_HIDE_RADIUS,
  DEFAULT_PUBLIC_SPEED_CAP,
  generatePublicProcessedTrack,
  getPublicProcessedPath,
  isPublicProcessedTrack,
} from "../src/utils/publicActivity.js";

interface PublicActivity {
  id: string;
  file_path: string;
  speed_cap: number | null;
  hide_radius: number | null;
}

interface Options {
  concurrency: number;
  dryRun: boolean;
  force: boolean;
  limit: number | null;
}

const BUCKET = "gpx-files";
const PAGE_SIZE = 500;

function namedKey(json: string | undefined) {
  if (!json) return undefined;
  try {
    const keys = JSON.parse(json) as Record<string, unknown>;
    return typeof keys.default === "string" ? keys.default : undefined;
  } catch {
    return undefined;
  }
}

function positiveInteger(value: string | undefined, option: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    concurrency: 3,
    dryRun: false,
    force: false,
    limit: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--concurrency") {
      options.concurrency = positiveInteger(argv[++index], "--concurrency");
    } else if (argument === "--limit") {
      options.limit = positiveInteger(argv[++index], "--limit");
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Backfill sanitized artifacts for every public drive.

Usage:
  npm run backfill:public-artifacts -- [options]

Options:
  --dry-run             Report work without uploading anything
  --force               Recreate artifacts that are already current
  --limit <count>       Process at most this many public drives
  --concurrency <count> Concurrent drives to process (default: 3)
  --help                Show this help

Required environment:
  SUPABASE_URL (or VITE_SUPABASE_URL)
  SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseServerGPX(xml: string): GPXPoint[] {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  }).parse(xml);
  const points: GPXPoint[] = [];

  for (const track of arrayOf(parsed?.gpx?.trk)) {
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

function hydrateProcessedPoints(track: ProcessedTrack): GPXPoint[] {
  return track.points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    ele: point.ele,
    time: point.time ? new Date(point.time) : undefined,
  }));
}

function expectedSettings(activity: PublicActivity) {
  return {
    speedCap: activity.speed_cap && activity.speed_cap > 0
      ? activity.speed_cap
      : DEFAULT_PUBLIC_SPEED_CAP,
    hideRadius: activity.hide_radius != null && activity.hide_radius >= 0
      ? activity.hide_radius
      : DEFAULT_PUBLIC_HIDE_RADIUS,
  };
}

async function artifactIsCurrent(admin: ReturnType<typeof createClient>, activity: PublicActivity) {
  const path = getPublicProcessedPath(activity.file_path);
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return false;

  try {
    const artifact = JSON.parse(await data.text());
    const expected = expectedSettings(activity);
    return isPublicProcessedTrack(artifact)
      && artifact.speedCap === expected.speedCap
      && artifact.hideRadius === expected.hideRadius;
  } catch {
    return false;
  }
}

async function loadSourcePoints(admin: ReturnType<typeof createClient>, activity: PublicActivity) {
  const processedPath = activity.file_path.replace(/\.gpx$/i, "") + ".processed.json";
  const { data: processedBlob, error: processedError } = await admin.storage
    .from(BUCKET)
    .download(processedPath);

  if (!processedError && processedBlob) {
    try {
      const track = JSON.parse(await processedBlob.text()) as ProcessedTrack;
      if (
        track.version === PROCESSED_TRACK_VERSION
        && Array.isArray(track.points)
        && track.points.length >= 2
      ) {
        return hydrateProcessedPoints(track);
      }
    } catch {
      // Fall through to the original GPX.
    }
  }

  const { data: gpxBlob, error: gpxError } = await admin.storage
    .from(BUCKET)
    .download(activity.file_path);
  if (gpxError || !gpxBlob) throw gpxError || new Error("Source GPX is unavailable");
  return parseServerGPX(await gpxBlob.text());
}

async function fetchPublicActivities(
  admin: ReturnType<typeof createClient>,
  limit: number | null,
) {
  const activities: PublicActivity[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const remaining = limit == null ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - activities.length);
    if (remaining <= 0) break;
    const { data, error } = await admin
      .from("activities")
      .select("id,file_path,speed_cap,hide_radius")
      .eq("public", true)
      .order("id", { ascending: true })
      .range(offset, offset + remaining - 1);
    if (error) throw error;

    const page = (data ?? []) as PublicActivity[];
    activities.push(...page);
    if (page.length < remaining) break;
  }

  return activities;
}

async function run() {
  const options = parseOptions(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY
    || namedKey(process.env.SUPABASE_SECRET_KEYS)
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL (or VITE_SUPABASE_URL) and "
      + "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const activities = await fetchPublicActivities(admin, options.limit);
  const counts = { created: 0, failed: 0, skipped: 0, wouldCreate: 0 };

  console.log(`Found ${activities.length} public drive(s).`);

  for (let offset = 0; offset < activities.length; offset += options.concurrency) {
    await Promise.all(activities.slice(offset, offset + options.concurrency).map(async (activity) => {
      try {
        if (!options.force && await artifactIsCurrent(admin, activity)) {
          counts.skipped++;
          return;
        }
        if (options.dryRun) {
          counts.wouldCreate++;
          return;
        }

        const points = await loadSourcePoints(admin, activity);
        if (points.length < 2) throw new Error("Drive contains fewer than two valid points");
        const artifact = generatePublicProcessedTrack(
          points,
          activity.speed_cap,
          activity.hide_radius,
        );
        const { error } = await admin.storage
          .from(BUCKET)
          .upload(
            getPublicProcessedPath(activity.file_path),
            new Blob([JSON.stringify(artifact)], { type: "application/json" }),
            { upsert: true },
          );
        if (error) throw error;
        counts.created++;
        console.log(`Created artifact for activity ${activity.id}`);
      } catch (error) {
        counts.failed++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed activity ${activity.id}: ${message}`);
      }
    }));
  }

  console.log(JSON.stringify(counts, null, 2));
  if (counts.failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
