import { useState, useRef, useCallback, useEffect } from "react";
import { Film, Download, Loader2, X, Play, ZoomIn, ZoomOut, Sun, Moon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GPXPoint, haversineDistance } from "@/utils/gpxParser";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const FPS = 30;
const TILE_SIZE = 256;
const MAP_LABEL_SCALE = 2;
const MAP_TILE_ZOOM_OFFSET = Math.log2(MAP_LABEL_SCALE);
const ROLLING_WINDOW_SECONDS = 30;
const SPEED_OPTIONS = [15, 30, 60, 120] as const;
const TILE_SUBDOMAINS = ["a", "b", "c", "d"];

// Map type tiles
const MAP_TYPES = [
    { id: "standard", label: "Standard" },
    { id: "terrain", label: "Terrain" },
    { id: "route", label: "Route Only" },
] as const;
type MapTypeId = typeof MAP_TYPES[number]["id"];

function getMapConfig(isDark: boolean, mapType: MapTypeId) {
    const darkColors = { bg: "#191919", textColor: "#FAFAF7", labelColor: "rgba(250,250,247,0.45)", hudBg: "rgba(25,25,25,0.88)" };
    const lightColors = { bg: "#E5E4DF", textColor: "#191919", labelColor: "rgba(25,25,25,0.45)", hudBg: "rgba(250,250,247,0.88)" };
    const colors = isDark ? darkColors : lightColors;
    let url = "";
    let styleKey = isDark ? "dark" : "light";
    if (mapType === "standard") {
        url = isDark
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
            : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";
    } else if (mapType === "terrain") {
        url = "https://tile.opentopomap.org/{z}/{x}/{y}.png";
        styleKey = "terrain";
        if (!isDark) Object.assign(colors, { bg: "#F2EFE9" });
    }
    // route: url stays empty
    return { ...colors, url, styleKey: `${styleKey}_${mapType}`, isLight: !isDark };
}

const ACCENT = "#CC785C";

const VIDEO_PRESETS = [
    { id: "square1080", label: "Square 1080", w: 1080, h: 1080, bitrate: 8_000_000 },
    { id: "reel720", label: "720p Reel", w: 720, h: 1280, bitrate: 4_500_000 },
    { id: "reel1080", label: "1080p Reel", w: 1080, h: 1920, bitrate: 8_000_000 },
    { id: "reel4k", label: "4K Reel", w: 2160, h: 3840, bitrate: 16_000_000 },
] as const;
type VideoPresetId = typeof VIDEO_PRESETS[number]["id"];

// ─── TYPES ──────────────────────────────────────────────────────────────────
interface ComputedPoint {
    lat: number; lon: number; ele: number;
    speed: number; distance: number; elapsedTime: number;
}

interface VideoGeneratorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    points: GPXPoint[];
    title: string;
}

interface RenderSettings {
    zoom: number;
    isDark: boolean;
    mapType: MapTypeId;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
function computePoints(raw: GPXPoint[]): ComputedPoint[] {
    if (raw.length === 0) return [];
    const startTime = raw[0].time!.getTime();
    const result: ComputedPoint[] = [];
    let cumDist = 0;
    for (let i = 0; i < raw.length; i++) {
        const p = raw[i];
        if (!p.time) continue;
        const elapsed = (p.time.getTime() - startTime) / 1000;
        let speed = 0;
        if (i > 0 && raw[i - 1].time) {
            const prev = raw[i - 1];
            const d = haversineDistance(prev.lat, prev.lon, p.lat, p.lon);
            const dt = (p.time.getTime() - prev.time!.getTime()) / 1000;
            cumDist += d;
            if (dt > 0 && dt < 60) { speed = (d / dt) * 3600; if (speed > 200) speed = 0; }
        }
        result.push({ lat: p.lat, lon: p.lon, ele: p.ele ?? 0, speed, distance: cumDist, elapsedTime: elapsed });
    }
    return result;
}

function interpolateAtTime(points: ComputedPoint[], t: number): ComputedPoint | null {
    if (points.length === 0) return null;
    if (t <= points[0].elapsedTime) return points[0];
    if (t >= points[points.length - 1].elapsedTime) return points[points.length - 1];
    let lo = 0, hi = points.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (points[mid].elapsedTime <= t) lo = mid; else hi = mid; }
    const a = points[lo], b = points[hi];
    const dt = b.elapsedTime - a.elapsedTime;
    const f = dt > 0 ? (t - a.elapsedTime) / dt : 0;
    return {
        lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f,
        ele: a.ele + (b.ele - a.ele) * f, speed: a.speed + (b.speed - a.speed) * f,
        distance: a.distance + (b.distance - a.distance) * f, elapsedTime: t,
    };
}

function rollingAvg(points: ComputedPoint[], t: number, key: "speed" | "ele"): number {
    const ws = Math.max(0, t - ROLLING_WINDOW_SECONDS);
    let sum = 0, cnt = 0;
    for (const p of points) {
        if (p.elapsedTime >= ws && p.elapsedTime <= t) { sum += p[key]; cnt++; }
        if (p.elapsedTime > t) break;
    }
    return cnt > 0 ? sum / cnt : 0;
}

function lonToTileX(lon: number, z: number) { return ((lon + 180) / 360) * (1 << z); }
function latToTileY(lat: number, z: number) {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z);
}
function geoToPixel(lat: number, lon: number, cLat: number, cLon: number, w: number, h: number, zoom: number) {
    return {
        x: (lonToTileX(lon, zoom) - lonToTileX(cLon, zoom)) * TILE_SIZE + w / 2,
        y: (latToTileY(lat, zoom) - latToTileY(cLat, zoom)) * TILE_SIZE + h / 2,
    };
}

function formatDur(s: number) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
function formatDist(km: number) { return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`; }

function drawRoutePath(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    route: ComputedPoint[],
    current: ComputedPoint,
    w: number,
    h: number,
    zoom: number,
    margin: number,
) {
    ctx.beginPath();
    let started = false;
    for (const point of route) {
        const { x, y } = geoToPixel(point.lat, point.lon, current.lat, current.lon, w, h, zoom);
        if (x < -margin || x > w + margin || y < -margin || y > h + margin) {
            started = false;
            continue;
        }
        if (!started) {
            ctx.moveTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    }
}

// ─── TILE CACHE (keyed by style+zoom+coords) ────────────────────────────────
const tileCache = new Map<string, HTMLImageElement>();

function tileCacheKey(styleId: string, z: number, x: number, y: number) {
    return `${styleId}_${z}_${x}_${y}`;
}

function getLabelTileZoom(zoom: number) {
    return Math.max(0, Math.round(zoom - MAP_TILE_ZOOM_OFFSET));
}

async function loadTile(styleId: string, tileUrl: string, z: number, x: number, y: number): Promise<HTMLImageElement | null> {
    if (!tileUrl) return null; // route-only mode
    const key = tileCacheKey(styleId, z, x, y);
    if (tileCache.has(key)) return tileCache.get(key)!;

    const subdomain = TILE_SUBDOMAINS[Math.abs(x + y) % TILE_SUBDOMAINS.length];
    const url = tileUrl
        .replace("{s}", subdomain)
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));

    const loadOnce = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        let settled = false;
        const finish = (result: HTMLImageElement | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve(result);
        };
        const timeout = window.setTimeout(() => {
            img.src = "";
            finish(null);
        }, 10_000);

        img.crossOrigin = "anonymous";
        img.onload = () => finish(img);
        img.onerror = () => finish(null);
        img.src = src;
    });

    for (let attempt = 0; attempt < 3; attempt++) {
        const cacheBust = attempt === 0 ? "" : `${url.includes("?") ? "&" : "?"}retry=${attempt}`;
        const img = await loadOnce(`${url}${cacheBust}`);
        if (img) {
            tileCache.set(key, img);
            return img;
        }
        await new Promise(resolve => window.setTimeout(resolve, 250 * (attempt + 1)));
    }

    return null;
}

function getMapHeight(w: number, h: number) {
    const statsH = Math.round(Math.min(h * 0.18, w * 0.18));
    return h - statsH;
}

function collectTileKeysForViewport(points: ComputedPoint[], zoom: number, w: number, h: number) {
    const tileZoom = getLabelTileZoom(zoom);
    const drawTileSize = TILE_SIZE * MAP_LABEL_SCALE;
    const mapH = getMapHeight(w, h);
    const halfX = Math.ceil(w / drawTileSize / 2) + 1;
    const halfY = Math.ceil(mapH / drawTileSize / 2) + 1;
    const needed = new Set<string>();

    for (const p of points) {
        const tx = Math.floor(lonToTileX(p.lon, tileZoom));
        const ty = Math.floor(latToTileY(p.lat, tileZoom));
        for (let dx = -halfX; dx <= halfX; dx++) {
            for (let dy = -halfY; dy <= halfY; dy++) {
                needed.add(`${tileZoom}_${tx + dx}_${ty + dy}`);
            }
        }
    }

    return needed;
}

async function prefetchTiles(
    points: ComputedPoint[],
    styleId: string,
    tileUrl: string,
    zoom: number,
    viewport: { w: number; h: number },
    onProgress?: (p: number) => void,
) {
    if (!tileUrl) { onProgress?.(1); return; } // route-only
    const needed = collectTileKeysForViewport(points, zoom, viewport.w, viewport.h);
    const keys = Array.from(needed);
    // Skip already cached tiles
    const uncached = keys.filter(k => !tileCache.has(`${styleId}_${k}`));
    if (uncached.length === 0) { onProgress?.(1); return; }

    const failed = new Set<string>();
    const batchSize = 30;
    for (let i = 0; i < uncached.length; i += batchSize) {
        const results = await Promise.all(uncached.slice(i, i + batchSize).map(async (k) => {
            const [z, x, y] = k.split("_").map(Number);
            const img = await loadTile(styleId, tileUrl, z, x, y);
            return { key: k, loaded: Boolean(img) };
        }));
        for (const result of results) {
            if (!result.loaded) failed.add(result.key);
        }
        onProgress?.(Math.min(1, (i + batchSize) / uncached.length));
    }

    if (failed.size > 0) {
        throw new Error(`Failed to load ${failed.size} map tile${failed.size === 1 ? "" : "s"}. Check the network and try again.`);
    }
}

// ─── RENDER ONE FRAME ───────────────────────────────────────────────────────
function renderFrame(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    W: number, H: number,
    points: ComputedPoint[], current: ComputedPoint,
    frameNum: number, totalRealTime: number,
    settings: RenderSettings,
) {
    const style = getMapConfig(settings.isDark, settings.mapType);
    const zoom = settings.zoom;
    const isLight = style.isLight;

    // Layout: compact stats strip at bottom, map fills the rest
    const mapH = getMapHeight(W, H); // map gets all remaining height
    const statsH = H - mapH;
    const mapCenterX = W / 2;
    const mapCenterY = mapH / 2;

    // Clear entire canvas
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, W, H);

    // ── Map region (clipped to square) ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, mapH);
    ctx.clip();

    // Map tiles (skip for route-only)
    if (style.url) {
        const previousSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        const tileZoom = getLabelTileZoom(zoom);
        const drawTileSize = TILE_SIZE * MAP_LABEL_SCALE;
        const cxf = lonToTileX(current.lon, tileZoom), cyf = latToTileY(current.lat, tileZoom);
        const ctX = Math.floor(cxf), ctY = Math.floor(cyf);
        const offX = (cxf - ctX) * drawTileSize, offY = (cyf - ctY) * drawTileSize;
        const halfX = Math.ceil(W / drawTileSize / 2) + 1, halfY = Math.ceil(mapH / drawTileSize / 2) + 1;
        for (let dx = -halfX; dx <= halfX; dx++) {
            for (let dy = -halfY; dy <= halfY; dy++) {
                const img = tileCache.get(tileCacheKey(style.styleKey, tileZoom, ctX + dx, ctY + dy));
                if (img) {
                    ctx.drawImage(
                        img,
                        Math.round(mapCenterX + dx * drawTileSize - offX),
                        Math.round(mapCenterY + dy * drawTileSize - offY),
                        drawTileSize,
                        drawTileSize,
                    );
                }
            }
        }
        ctx.imageSmoothingEnabled = previousSmoothing;
    }

    // Route
    const step = Math.max(1, Math.floor(points.length / 2000));
    const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    const traveledRoute = sampled.filter((p) => p.elapsedTime < current.elapsedTime);
    const upcomingRoute = sampled.filter((p) => p.elapsedTime > current.elapsedTime);
    traveledRoute.push(current);
    upcomingRoute.unshift(current);
    const margin = 300;
    const routeColor = ACCENT;
    const upcomingAlpha = isLight ? 0.2 : 0.12;

    // Upcoming (faint)
    drawRoutePath(ctx, upcomingRoute, current, W, mapH, zoom, margin);
    ctx.strokeStyle = `rgba(204, 120, 92, ${upcomingAlpha})`;
    ctx.lineWidth = settings.mapType === "route" ? 4 : 3;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();

    // Traveled (glow)
    drawRoutePath(ctx, traveledRoute, current, W, mapH, zoom, margin);
    const glowWidth = settings.mapType === "route" ? 20 : 14;
    ctx.strokeStyle = `rgba(204, 120, 92, 0.15)`; ctx.lineWidth = glowWidth; ctx.stroke();
    ctx.strokeStyle = `rgba(204, 120, 92, 0.4)`; ctx.lineWidth = glowWidth * 0.57; ctx.stroke();
    ctx.strokeStyle = routeColor; ctx.lineWidth = settings.mapType === "route" ? 4 : 3; ctx.stroke();

    // Position marker (centered in map square)
    const pulse = Math.sin(frameNum * 0.12) * 0.14 + 1.0;
    const grad = ctx.createRadialGradient(mapCenterX, mapCenterY, 0, mapCenterX, mapCenterY, 25 * pulse);
    grad.addColorStop(0, "rgba(204, 120, 92, 0.6)");
    grad.addColorStop(0.5, "rgba(204, 120, 92, 0.2)");
    grad.addColorStop(1, "rgba(204, 120, 92, 0)");
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(mapCenterX, mapCenterY, 25 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mapCenterX, mapCenterY, 7, 0, Math.PI * 2);
    ctx.fillStyle = isLight ? "#191919" : "#FAFAF7"; ctx.fill();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.5; ctx.stroke();

    ctx.restore(); // end map clip

    // ── Stats strip below map (single inline row) ──
    const avgSpeed = rollingAvg(points, current.elapsedTime, "speed");
    const avgEle = rollingAvg(points, current.elapsedTime, "ele");

    const panelY = mapH;

    // Subtle separator line
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)";
    ctx.fillRect(0, panelY, W, 1);

    // 4 stats in a single row, evenly spaced
    const labelSize = Math.round(W * 0.018);
    const valueSize = Math.round(W * 0.042);
    const colW = W / 4;
    const statsCenterY = panelY + statsH * 0.38; // upper portion for stats

    const cells = [
        { label: "SPEED", value: `${Math.round(avgSpeed)}`, unit: "km/h" },
        { label: "DISTANCE", value: formatDist(current.distance), unit: "" },
        { label: "ELEVATION", value: `${Math.round(avgEle)}`, unit: "m" },
        { label: "TIME", value: formatDur(current.elapsedTime), unit: "" },
    ];
    for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const cx = colW * i + colW / 2;
        // Label
        ctx.fillStyle = style.labelColor; ctx.font = `600 ${labelSize}px sans-serif`; ctx.textAlign = "center";
        ctx.fillText(c.label, cx, statsCenterY - valueSize * 0.3);
        // Value + unit
        ctx.fillStyle = style.textColor; ctx.font = `bold ${valueSize}px sans-serif`; ctx.textAlign = "center";
        const valText = c.unit ? `${c.value} ${c.unit}` : c.value;
        ctx.fillText(valText, cx, statsCenterY + valueSize * 0.55);
    }

    // "driven" branding
    const brandSize = Math.round(W * 0.022);
    ctx.fillStyle = style.labelColor; ctx.font = `700 ${brandSize}px sans-serif`; ctx.textAlign = "center";
    ctx.fillText("DrivenStat", W / 2, panelY + statsH - Math.round(statsH * 0.15));

    // Progress bar at very bottom
    const barH = Math.round(H * 0.003);
    const barY = H - barH;
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)";
    ctx.fillRect(0, barY, W, barH);
    ctx.fillStyle = ACCENT; ctx.fillRect(0, barY, W * (current.elapsedTime / totalRealTime), barH);
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────
const VideoGenerator = ({ open, onOpenChange, points, title }: VideoGeneratorProps) => {
    const [videoPresetId, setVideoPresetId] = useState<VideoPresetId>("square1080");
    const [zoom, setZoom] = useState(14);
    const [isDark, setIsDark] = useState(true);
    const [mapType, setMapType] = useState<MapTypeId>("standard");
    const [speedMultiplier, setSpeedMultiplier] = useState(30);
    const [phase, setPhase] = useState<"idle" | "prefetch" | "preview" | "generating" | "done">("idle");
    const [progress, setProgress] = useState(0);
    const [frameInfo, setFrameInfo] = useState("");
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const abortRef = useRef(false);
    const computed = useRef<ComputedPoint[]>([]);

    const settings: RenderSettings = { zoom, isDark, mapType };
    const mapConfig = getMapConfig(isDark, mapType);

    // Compute points once when dialog opens
    useEffect(() => {
        if (open && points.length > 0) {
            computed.current = computePoints(points);
            setPhase("idle");
            setProgress(0);
            setFrameInfo("");
            setBlobUrl(null);
            abortRef.current = false;
        }
        return () => { abortRef.current = true; cancelAnimationFrame(animFrameRef.current); };
    }, [open, points]);

    // Re-trigger preview when settings change during preview
    useEffect(() => {
        if (phase !== "preview") return;
        const pts = computed.current;
        if (pts.length === 0) return;
        const canvas = previewCanvasRef.current;
        if (!canvas) return;

        // Re-fetch tiles for new style/zoom
        abortRef.current = true;
        cancelAnimationFrame(animFrameRef.current);

        const doPreview = async () => {
            abortRef.current = false;
            const ctx = canvas.getContext("2d")!;
            const W = canvas.width, H = canvas.height;
            try {
                if (mapConfig.url) {
                    await prefetchTiles(pts, mapConfig.styleKey, mapConfig.url, zoom, { w: W, h: H });
                }
            } catch (error) {
                console.error("Failed to load map tiles for preview:", error);
                setPhase("idle");
                return;
            }

            const totalRealTime = pts[pts.length - 1].elapsedTime;
            let frame = 0;

            const animate = () => {
                if (abortRef.current) return;
                const realTime = (frame / FPS) * speedMultiplier;
                if (realTime > totalRealTime) frame = 0;
                const current = interpolateAtTime(pts, realTime);
                if (current) {
                    renderFrame(ctx, W, H, pts, current, frame, totalRealTime, settings);
                }
                frame++;
                animFrameRef.current = requestAnimationFrame(animate);
            };
            animate();
        };
        doPreview();

        return () => { abortRef.current = true; cancelAnimationFrame(animFrameRef.current); };
    }, [phase, zoom, isDark, mapType, speedMultiplier, videoPresetId]);

    const startPreview = useCallback(async () => {
        const pts = computed.current;
        if (pts.length === 0) return;
        setPhase("prefetch");
        try {
            await prefetchTiles(pts, mapConfig.styleKey, mapConfig.url, zoom, { w: previewW, h: previewH }, (p) => setProgress(p));
            setProgress(0);
            setPhase("preview");
        } catch (error) {
            console.error("Failed to load map tiles:", error);
            alert(error instanceof Error ? error.message : "Failed to load map tiles. Check the network and try again.");
            setPhase("idle");
        }
    }, [zoom, isDark, mapType, previewW, previewH, mapConfig.styleKey, mapConfig.url]);

    const generateVideo = useCallback(async () => {
        const pts = computed.current;
        if (pts.length === 0) return;
        abortRef.current = false;
        cancelAnimationFrame(animFrameRef.current);

        const res = VIDEO_PRESETS.find((preset) => preset.id === videoPresetId) ?? VIDEO_PRESETS[0];
        const W = res.w, H = res.h;
        setPhase("generating");
        setProgress(0);

        const totalRealTime = pts[pts.length - 1].elapsedTime;
        const videoSeconds = totalRealTime / speedMultiplier;
        const totalFrames = Math.ceil(videoSeconds * FPS);
        const startedAt = performance.now();
        console.log(`🎬 Starting encode: ${totalFrames} frames, ${res.label}, ${Math.round(videoSeconds)}s video`);

        const offscreen = new OffscreenCanvas(W, H);
        const ctx = offscreen.getContext("2d")!;

        const muxerTarget = new ArrayBufferTarget();
        const muxer = new Muxer({
            target: muxerTarget,
            video: { codec: "avc", width: W, height: H },
            fastStart: "in-memory",
        });

        const encoder = new VideoEncoder({
            output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); },
            error: (e) => console.error("VideoEncoder error:", e),
        });

        const codecString = W > 1500 ? "avc1.640033" : "avc1.640028";
        const config: VideoEncoderConfig = {
            codec: codecString, width: W, height: H,
            bitrate: res.bitrate,
            framerate: FPS,
        };

        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) {
            console.error("❌ VideoEncoder config not supported:", config);
            alert(`Your browser doesn't support encoding at ${res.label}. Try a lower resolution.`);
            setPhase("preview");
            return;
        }
        console.log("✅ Codec supported:", codecString);
        encoder.configure(config);

        // Ensure tiles are loaded for the generation zoom/style
        try {
            await prefetchTiles(pts, mapConfig.styleKey, mapConfig.url, zoom, { w: W, h: H });
        } catch (error) {
            encoder.close();
            console.error("Failed to load map tiles for generation:", error);
            alert(error instanceof Error ? error.message : "Failed to load map tiles. Check the network and try again.");
            setPhase("preview");
            return;
        }

        // IMPORTANT: Reset abort flag here, after all async setup.
        // The preview effect cleanup may have set it to true during the awaits above.
        abortRef.current = false;

        console.log(`🎬 Encoding ${totalFrames} frames...`);
        for (let frame = 0; frame < totalFrames; frame++) {
            if (abortRef.current) { encoder.close(); return; }

            const realTime = (frame / FPS) * speedMultiplier;
            const current = interpolateAtTime(pts, realTime);
            if (!current) continue;

            renderFrame(ctx, W, H, pts, current, frame, totalRealTime, settings);

            const vf = new VideoFrame(offscreen, { timestamp: (frame / FPS) * 1_000_000, duration: (1 / FPS) * 1_000_000 });
            encoder.encode(vf, { keyFrame: frame % (FPS * 2) === 0 });
            vf.close();

            if (encoder.encodeQueueSize > 5) {
                await new Promise<void>(r => { const check = () => { if (encoder.encodeQueueSize <= 2) r(); else setTimeout(check, 5); }; check(); });
            }

            if (frame % 5 === 0) {
                setProgress(frame / totalFrames);
                setFrameInfo(`Frame ${frame}/${totalFrames}`);
                if (frame % 100 === 0) {
                    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
                    const fps = frame > 0 ? (frame / ((performance.now() - startedAt) / 1000)).toFixed(1) : '0';
                    console.log(`📊 Frame ${frame}/${totalFrames} (${Math.round(frame / totalFrames * 100)}%) — ${elapsed}s elapsed, ${fps} fps`);
                }
                await new Promise(r => setTimeout(r, 0));
            }
        }

        await encoder.flush();
        encoder.close();
        muxer.finalize();

        const totalTime = ((performance.now() - startedAt) / 1000).toFixed(1);
        console.log(`✅ Encode complete: ${totalFrames} frames in ${totalTime}s (${(totalFrames / parseFloat(totalTime)).toFixed(1)} fps avg)`);

        const blob = new Blob([muxerTarget.buffer], { type: "video/mp4" });
        setBlobUrl(URL.createObjectURL(blob));
        setPhase("done");
        setProgress(1);
    }, [videoPresetId, zoom, isDark, mapType, speedMultiplier]);

    const handleClose = () => {
        abortRef.current = true;
        cancelAnimationFrame(animFrameRef.current);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
        setPhase("idle");
        setProgress(0);
        setFrameInfo("");
        onOpenChange(false);
    };

    const res = VIDEO_PRESETS.find((preset) => preset.id === videoPresetId) ?? VIDEO_PRESETS[0];
    const previewW = 270;
    const previewH = Math.round(previewW * (res.h / res.w));
    const canEdit = phase === "idle" || phase === "preview";

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-[420px] p-0 gap-0 overflow-hidden">
                {/* Header */}
                <div className="px-5 pt-5 pb-3">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <Film className="w-4 h-4 text-primary" />
                            Generate Video
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Timelapse · processed on your device
                        </DialogDescription>
                    </DialogHeader>
                </div>

                {/* Scrollable body */}
                <div className="px-5 pb-4 space-y-3 max-h-[calc(90vh-140px)] overflow-y-auto">
                    {/* Row 1: Preset + Speed side by side */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preset</span>
                            <div className="grid grid-cols-2 gap-1 mt-1">
                                {VIDEO_PRESETS.map((preset) => (
                                    <button key={preset.id} onClick={() => canEdit && setVideoPresetId(preset.id)}
                                        className={`py-1 rounded text-[10px] font-bold transition-all border ${preset.id === videoPresetId
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50"}`}
                                        disabled={!canEdit}>
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Speed</span>
                            <div className="flex gap-1 mt-1">
                                {SPEED_OPTIONS.map((sp) => (
                                    <button key={sp} onClick={() => canEdit && setSpeedMultiplier(sp)}
                                        className={`flex-1 py-1 rounded text-[11px] font-bold transition-all border ${sp === speedMultiplier
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50"}`}
                                        disabled={!canEdit}>
                                        {sp}×
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Row 2: Map Type + Dark/Light */}
                    <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                        <div>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Map</span>
                            <div className="flex gap-1 mt-1">
                                {MAP_TYPES.map((mt) => (
                                    <button key={mt.id} onClick={() => canEdit && setMapType(mt.id)}
                                        className={`flex-1 py-1 rounded text-[11px] font-bold transition-all border ${mt.id === mapType
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50"}`}
                                        disabled={!canEdit}>
                                        {mt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button
                            onClick={() => canEdit && setIsDark(d => !d)}
                            disabled={!canEdit}
                            className="p-1.5 rounded-md border bg-muted/30 hover:bg-muted/50 text-muted-foreground transition-all mb-[1px]"
                            title={isDark ? "Switch to Light" : "Switch to Dark"}
                        >
                            {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                        </button>
                    </div>

                    {/* Row 3: Zoom slider */}
                    <div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Zoom</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{zoom}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <button onClick={() => canEdit && setZoom(z => Math.max(10, z - 1))}
                                disabled={!canEdit || zoom <= 10}
                                className="p-0.5 rounded bg-muted/30 hover:bg-muted/50 text-muted-foreground disabled:opacity-30">
                                <ZoomOut className="w-3 h-3" />
                            </button>
                            <input type="range" min={10} max={17} value={zoom}
                                onChange={(e) => canEdit && setZoom(Number(e.target.value))}
                                disabled={!canEdit}
                                className="flex-1 h-1 accent-primary" />
                            <button onClick={() => canEdit && setZoom(z => Math.min(17, z + 1))}
                                disabled={!canEdit || zoom >= 17}
                                className="p-0.5 rounded bg-muted/30 hover:bg-muted/50 text-muted-foreground disabled:opacity-30">
                                <ZoomIn className="w-3 h-3" />
                            </button>
                        </div>
                    </div>

                    {/* Preview Area */}
                    <div
                        className="relative w-full rounded-lg overflow-hidden border border-border bg-black flex items-center justify-center"
                        style={{ aspectRatio: `${res.w} / ${res.h}`, maxHeight: 300 }}
                    >
                        {phase === "idle" && (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <Play className="w-8 h-8 opacity-30" />
                                <span className="text-[10px]">Tap Preview to start</span>
                            </div>
                        )}

                        {phase === "prefetch" && (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span className="text-[10px]">Loading tiles… {Math.round(progress * 100)}%</span>
                            </div>
                        )}

                        {(phase === "preview" || phase === "generating" || phase === "done") && (
                            <canvas ref={previewCanvasRef} width={previewW} height={previewH}
                                className="w-full h-full object-contain" />
                        )}

                        {phase === "generating" && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 backdrop-blur-[1px]">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                <span className="text-white text-sm font-semibold">{Math.round(progress * 100)}%</span>
                                <span className="text-white/50 text-[9px]">{frameInfo || `Starting ${res.label} encode…`}</span>
                            </div>
                        )}

                        {phase === "done" && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <span className="text-white text-sm font-semibold">✅ Ready</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sticky action bar */}
                <div className="px-5 py-3 border-t border-border bg-background">
                    {phase === "idle" && (
                        <Button onClick={startPreview} className="w-full gap-2">
                            <Play className="w-4 h-4" /> Preview
                        </Button>
                    )}

                    {phase === "preview" && (
                        <Button onClick={generateVideo} className="w-full gap-2">
                            <Film className="w-4 h-4" /> Generate {res.label} · {speedMultiplier}×
                        </Button>
                    )}

                    {phase === "generating" && (
                        <Button variant="destructive" onClick={() => { abortRef.current = true; setPhase("preview"); }} className="w-full gap-2">
                            <X className="w-4 h-4" /> Cancel
                        </Button>
                    )}

                    {phase === "done" && blobUrl && (
                        <a href={blobUrl} download={`${title}_${speedMultiplier}x.mp4`}>
                            <Button className="w-full gap-2">
                                <Download className="w-4 h-4" /> Download MP4
                            </Button>
                        </a>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default VideoGenerator;
