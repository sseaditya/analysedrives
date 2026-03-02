import { useState, useRef, useCallback, useEffect } from "react";
import { Film, Download, Loader2, X, Play, ZoomIn, ZoomOut, Sun, Moon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GPXPoint, haversineDistance } from "@/utils/gpxParser";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const FPS = 30;
const TILE_SIZE = 256;
const ROLLING_WINDOW_SECONDS = 30;
const SPEED_OPTIONS = [15, 30, 60, 120] as const;

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
            ? "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
            : "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";
    } else if (mapType === "terrain") {
        url = "https://tile.opentopomap.org/{z}/{x}/{y}.png";
        styleKey = "terrain";
        if (!isDark) Object.assign(colors, { bg: "#F2EFE9" });
    }
    // route: url stays empty
    return { ...colors, url, styleKey: `${styleKey}_${mapType}`, isLight: !isDark };
}

const ACCENT = "#CC785C";

const RESOLUTIONS = [
    { label: "720p", w: 720, h: 1280 },
    { label: "1080p", w: 1080, h: 1920 },
    { label: "4K", w: 2160, h: 3840 },
] as const;

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

// ─── TILE CACHE (keyed by style+zoom+coords) ────────────────────────────────
const tileCache = new Map<string, HTMLImageElement>();

function tileCacheKey(styleId: string, z: number, x: number, y: number) {
    return `${styleId}_${z}_${x}_${y}`;
}

async function loadTile(styleId: string, tileUrl: string, z: number, x: number, y: number): Promise<HTMLImageElement | null> {
    if (!tileUrl) return null; // route-only mode
    const key = tileCacheKey(styleId, z, x, y);
    if (tileCache.has(key)) return tileCache.get(key)!;
    const url = tileUrl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { tileCache.set(key, img); resolve(img); };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

async function prefetchTiles(points: ComputedPoint[], styleId: string, tileUrl: string, zoom: number, onProgress?: (p: number) => void) {
    if (!tileUrl) { onProgress?.(1); return; } // route-only
    const needed = new Set<string>();
    for (const p of points) {
        const tx = Math.floor(lonToTileX(p.lon, zoom));
        const ty = Math.floor(latToTileY(p.lat, zoom));
        for (let dx = -3; dx <= 3; dx++) for (let dy = -4; dy <= 4; dy++) needed.add(`${zoom}_${tx + dx}_${ty + dy}`);
    }
    const keys = Array.from(needed);
    // Skip already cached tiles
    const uncached = keys.filter(k => !tileCache.has(`${styleId}_${k}`));
    if (uncached.length === 0) { onProgress?.(1); return; }

    const batchSize = 30;
    for (let i = 0; i < uncached.length; i += batchSize) {
        await Promise.all(uncached.slice(i, i + batchSize).map(k => {
            const [z, x, y] = k.split("_").map(Number);
            return loadTile(styleId, tileUrl, z, x, y);
        }));
        onProgress?.(Math.min(1, (i + batchSize) / uncached.length));
    }
}

// ─── RENDER ONE FRAME ───────────────────────────────────────────────────────
function renderFrame(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    W: number, H: number,
    points: ComputedPoint[], currentIdx: number, current: ComputedPoint,
    frameNum: number, totalRealTime: number,
    settings: RenderSettings,
) {
    const style = getMapConfig(settings.isDark, settings.mapType);
    const zoom = settings.zoom;
    const isLight = style.isLight;

    // Layout: square map (W×W) at top, stats panel below
    const mapH = W; // square map
    const statsH = H - mapH; // remaining space for stats
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
        const cxf = lonToTileX(current.lon, zoom), cyf = latToTileY(current.lat, zoom);
        const ctX = Math.floor(cxf), ctY = Math.floor(cyf);
        const offX = (cxf - ctX) * TILE_SIZE, offY = (cyf - ctY) * TILE_SIZE;
        const halfX = Math.ceil(W / TILE_SIZE / 2) + 1, halfY = Math.ceil(mapH / TILE_SIZE / 2) + 1;
        for (let dx = -halfX; dx <= halfX; dx++) {
            for (let dy = -halfY; dy <= halfY; dy++) {
                const img = tileCache.get(tileCacheKey(style.styleKey, zoom, ctX + dx, ctY + dy));
                if (img) ctx.drawImage(img, mapCenterX + dx * TILE_SIZE - offX, mapCenterY + dy * TILE_SIZE - offY, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    // Route
    const step = Math.max(1, Math.floor(points.length / 2000));
    const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    const csi = Math.min(Math.floor(currentIdx / step), sampled.length - 1);
    const margin = 300;
    const routeColor = ACCENT;
    const upcomingAlpha = isLight ? 0.2 : 0.12;

    // Upcoming (faint)
    ctx.beginPath();
    let s = false;
    for (let i = csi; i < sampled.length; i++) {
        const { x, y } = geoToPixel(sampled[i].lat, sampled[i].lon, current.lat, current.lon, W, mapH, zoom);
        if (x < -margin || x > W + margin || y < -margin || y > mapH + margin) { s = false; continue; }
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(204, 120, 92, ${upcomingAlpha})`;
    ctx.lineWidth = settings.mapType === "route" ? 4 : 3;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();

    // Traveled (glow)
    ctx.beginPath(); s = false;
    for (let i = 0; i <= csi && i < sampled.length; i++) {
        const { x, y } = geoToPixel(sampled[i].lat, sampled[i].lon, current.lat, current.lon, W, mapH, zoom);
        if (x < -margin || x > W + margin || y < -margin || y > mapH + margin) { s = false; continue; }
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    }
    const glowWidth = settings.mapType === "route" ? 20 : 14;
    ctx.strokeStyle = `rgba(204, 120, 92, 0.15)`; ctx.lineWidth = glowWidth; ctx.stroke();
    ctx.strokeStyle = `rgba(204, 120, 92, 0.4)`; ctx.lineWidth = glowWidth * 0.57; ctx.stroke();
    ctx.strokeStyle = routeColor; ctx.lineWidth = settings.mapType === "route" ? 4 : 3; ctx.stroke();

    // Position marker (centered in map square)
    const pulse = Math.sin(frameNum * 0.15) * 0.3 + 1.0;
    const grad = ctx.createRadialGradient(mapCenterX, mapCenterY, 0, mapCenterX, mapCenterY, 25 * pulse);
    grad.addColorStop(0, "rgba(204, 120, 92, 0.6)");
    grad.addColorStop(0.5, "rgba(204, 120, 92, 0.2)");
    grad.addColorStop(1, "rgba(204, 120, 92, 0)");
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(mapCenterX, mapCenterY, 25 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mapCenterX, mapCenterY, 7, 0, Math.PI * 2);
    ctx.fillStyle = isLight ? "#191919" : "#FAFAF7"; ctx.fill();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.5; ctx.stroke();

    ctx.restore(); // end map clip

    // ── Stats panel below map ──
    const avgSpeed = rollingAvg(points, current.elapsedTime, "speed");
    const avgEle = rollingAvg(points, current.elapsedTime, "ele");

    const panelY = mapH;
    const panelPad = Math.round(W * 0.05);

    // Subtle separator line at top of stats panel
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)";
    ctx.fillRect(0, panelY, W, 1);

    // Stats layout: 2×2 grid in the stats panel
    const gridX = panelPad;
    const gridW = W - panelPad * 2;
    const gridY = panelY + Math.round(statsH * 0.08);
    const gridH = statsH - Math.round(statsH * 0.16);
    const colW = gridW / 2;
    const rowH = gridH / 2;

    const labelSize = Math.round(W * 0.022);
    const valueSize = Math.round(W * 0.065);
    const unitSize = Math.round(W * 0.028);

    const cells = [
        { label: "SPEED", value: `${Math.round(avgSpeed)}`, unit: "km/h", col: 0, row: 0 },
        { label: "DISTANCE", value: formatDist(current.distance), unit: "", col: 1, row: 0 },
        { label: "ELEVATION", value: `${Math.round(avgEle)} m`, unit: "", col: 0, row: 1 },
        { label: "TIME", value: formatDur(current.elapsedTime), unit: "", col: 1, row: 1 },
    ];
    for (const c of cells) {
        const cx = gridX + c.col * colW;
        const cy = gridY + c.row * rowH;
        ctx.fillStyle = style.labelColor; ctx.font = `600 ${labelSize}px sans-serif`; ctx.textAlign = "left";
        ctx.fillText(c.label, cx, cy + labelSize + 2);
        ctx.fillStyle = style.textColor; ctx.font = `bold ${valueSize}px sans-serif`;
        ctx.fillText(c.value, cx, cy + labelSize + valueSize + 8);
        if (c.unit) {
            const vw = ctx.measureText(c.value).width;
            ctx.fillStyle = style.labelColor; ctx.font = `600 ${unitSize}px sans-serif`;
            ctx.fillText(` ${c.unit}`, cx + vw, cy + labelSize + valueSize + 8);
        }
    }

    // Progress bar at very bottom
    const barH = Math.round(H * 0.003);
    const barY = H - barH;
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)";
    ctx.fillRect(0, barY, W, barH);
    ctx.fillStyle = ACCENT; ctx.fillRect(0, barY, W * (current.elapsedTime / totalRealTime), barH);
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────
const VideoGenerator = ({ open, onOpenChange, points, title }: VideoGeneratorProps) => {
    const [resolution, setResolution] = useState(0);
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
            if (mapConfig.url) {
                await prefetchTiles(pts, mapConfig.styleKey, mapConfig.url, zoom);
            }

            const totalRealTime = pts[pts.length - 1].elapsedTime;
            const ctx = canvas.getContext("2d")!;
            const W = canvas.width, H = canvas.height;
            let frame = 0;

            const animate = () => {
                if (abortRef.current) return;
                const realTime = (frame / FPS) * speedMultiplier;
                if (realTime > totalRealTime) frame = 0;
                const current = interpolateAtTime(pts, realTime);
                if (current) {
                    let lo = 0, hi = pts.length - 1;
                    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].elapsedTime < realTime) lo = mid + 1; else hi = mid; }
                    renderFrame(ctx, W, H, pts, lo, current, frame, totalRealTime, settings);
                }
                frame++;
                animFrameRef.current = requestAnimationFrame(animate);
            };
            animate();
        };
        doPreview();

        return () => { abortRef.current = true; cancelAnimationFrame(animFrameRef.current); };
    }, [phase, zoom, isDark, mapType, speedMultiplier]);

    const startPreview = useCallback(async () => {
        const pts = computed.current;
        if (pts.length === 0) return;
        setPhase("prefetch");
        await prefetchTiles(pts, mapConfig.styleKey, mapConfig.url, zoom, (p) => setProgress(p));
        setProgress(0);
        setPhase("preview");
    }, [zoom, isDark, mapType]);

    const generateVideo = useCallback(async () => {
        const pts = computed.current;
        if (pts.length === 0) return;
        abortRef.current = false;
        cancelAnimationFrame(animFrameRef.current);

        const res = RESOLUTIONS[resolution];
        const W = res.w, H = res.h;
        setPhase("generating");
        setProgress(0);

        const totalRealTime = pts[pts.length - 1].elapsedTime;
        const videoSeconds = totalRealTime / speedMultiplier;
        const totalFrames = Math.ceil(videoSeconds * FPS);
        const startedAt = performance.now();
        console.log(`🎬 Starting encode: ${totalFrames} frames, ${RESOLUTIONS[resolution].label}, ${Math.round(videoSeconds)}s video`);

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
            bitrate: W > 1500 ? 12_000_000 : W > 800 ? 6_000_000 : 3_000_000,
            framerate: FPS,
        };

        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) {
            console.error("❌ VideoEncoder config not supported:", config);
            alert(`Your browser doesn't support encoding at ${RESOLUTIONS[resolution].label}. Try a lower resolution.`);
            setPhase("preview");
            return;
        }
        console.log("✅ Codec supported:", codecString);
        encoder.configure(config);

        // Ensure tiles are loaded for the generation zoom/style
        await prefetchTiles(pts, mapConfig.styleKey, mapConfig.url, zoom);

        // IMPORTANT: Reset abort flag here, after all async setup.
        // The preview effect cleanup may have set it to true during the awaits above.
        abortRef.current = false;

        console.log(`🎬 Encoding ${totalFrames} frames...`);
        for (let frame = 0; frame < totalFrames; frame++) {
            if (abortRef.current) { encoder.close(); return; }

            const realTime = (frame / FPS) * speedMultiplier;
            const current = interpolateAtTime(pts, realTime);
            if (!current) continue;

            let lo = 0, hi = pts.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].elapsedTime < realTime) lo = mid + 1; else hi = mid; }

            renderFrame(ctx, W, H, pts, lo, current, frame, totalRealTime, settings);

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
    }, [resolution, zoom, isDark, mapType, speedMultiplier]);

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

    const res = RESOLUTIONS[resolution];
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
                    {/* Row 1: Resolution + Speed side by side */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Resolution</span>
                            <div className="flex gap-1 mt-1">
                                {RESOLUTIONS.map((r, i) => (
                                    <button key={r.label} onClick={() => canEdit && setResolution(i)}
                                        className={`flex-1 py-1 rounded text-[11px] font-bold transition-all border ${i === resolution
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50"}`}
                                        disabled={!canEdit}>
                                        {r.label}
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
                                <span className="text-white/50 text-[9px]">{frameInfo || `Starting ${RESOLUTIONS[resolution].label} encode…`}</span>
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
                            <Film className="w-4 h-4" /> Generate {RESOLUTIONS[resolution].label} · {speedMultiplier}×
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
