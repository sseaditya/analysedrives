import { useState, useRef, useCallback, useEffect } from "react";
import { Film, Download, Loader2, X, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GPXPoint, haversineDistance } from "@/utils/gpxParser";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const SPEED_MULTIPLIER = 30;
const FPS = 30;
const TILE_SIZE = 256;
const ZOOM = 14;
const TILE_URL = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png";
const ROLLING_WINDOW_SECONDS = 30;

// Platform colors
const COLORS = {
    bg: "#191919",
    hudBg: "rgba(25, 25, 25, 0.88)",
    hudBorder: "rgba(204, 120, 92, 0.3)",
    text: "#FAFAF7",
    label: "rgba(250, 250, 247, 0.45)",
    accent: "#CC785C",       // terracotta
    routeTraveled: "#CC785C",
    routeGlow: "rgba(204, 120, 92, 0.4)",
    routeGlowOuter: "rgba(204, 120, 92, 0.15)",
    routeUpcoming: "rgba(204, 120, 92, 0.12)",
    positionDot: "#FAFAF7",
};

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
            if (dt > 0 && dt < 60) {
                speed = (d / dt) * 3600;
                if (speed > 200) speed = 0;
            }
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
function geoToPixel(lat: number, lon: number, cLat: number, cLon: number, w: number, h: number) {
    return {
        x: (lonToTileX(lon, ZOOM) - lonToTileX(cLon, ZOOM)) * TILE_SIZE + w / 2,
        y: (latToTileY(lat, ZOOM) - latToTileY(cLat, ZOOM)) * TILE_SIZE + h / 2,
    };
}

function formatDur(s: number) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
function formatDist(km: number) { return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`; }

// ─── TILE CACHE ─────────────────────────────────────────────────────────────
const tileCache = new Map<string, HTMLImageElement>();

async function loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
    const key = `${z}_${x}_${y}`;
    if (tileCache.has(key)) return tileCache.get(key)!;
    const url = TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { tileCache.set(key, img); resolve(img); };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

async function prefetchTiles(points: ComputedPoint[], onProgress?: (p: number) => void) {
    const needed = new Set<string>();
    for (const p of points) {
        const tx = Math.floor(lonToTileX(p.lon, ZOOM));
        const ty = Math.floor(latToTileY(p.lat, ZOOM));
        for (let dx = -3; dx <= 3; dx++) for (let dy = -4; dy <= 4; dy++) needed.add(`${ZOOM}_${tx + dx}_${ty + dy}`);
    }
    const keys = Array.from(needed);
    const batchSize = 30;
    for (let i = 0; i < keys.length; i += batchSize) {
        await Promise.all(keys.slice(i, i + batchSize).map(k => {
            const [z, x, y] = k.split("_").map(Number);
            return loadTile(z, x, y);
        }));
        onProgress?.(Math.min(1, (i + batchSize) / keys.length));
    }
}

// ─── RENDER ONE FRAME ───────────────────────────────────────────────────────
function renderFrame(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    W: number, H: number,
    points: ComputedPoint[], currentIdx: number, current: ComputedPoint,
    frameNum: number, totalRealTime: number,
) {
    // Clear
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // Map tiles
    const cxf = lonToTileX(current.lon, ZOOM), cyf = latToTileY(current.lat, ZOOM);
    const ctX = Math.floor(cxf), ctY = Math.floor(cyf);
    const offX = (cxf - ctX) * TILE_SIZE, offY = (cyf - ctY) * TILE_SIZE;
    const halfX = Math.ceil(W / TILE_SIZE / 2) + 1, halfY = Math.ceil(H / TILE_SIZE / 2) + 1;
    for (let dx = -halfX; dx <= halfX; dx++) {
        for (let dy = -halfY; dy <= halfY; dy++) {
            const img = tileCache.get(`${ZOOM}_${ctX + dx}_${ctY + dy}`);
            if (img) ctx.drawImage(img, W / 2 + dx * TILE_SIZE - offX, H / 2 + dy * TILE_SIZE - offY, TILE_SIZE, TILE_SIZE);
        }
    }

    // Route
    const step = Math.max(1, Math.floor(points.length / 2000));
    const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    const csi = Math.min(Math.floor(currentIdx / step), sampled.length - 1);
    const margin = 300;

    // Upcoming (faint)
    ctx.beginPath();
    let s = false;
    for (let i = csi; i < sampled.length; i++) {
        const { x, y } = geoToPixel(sampled[i].lat, sampled[i].lon, current.lat, current.lon, W, H);
        if (x < -margin || x > W + margin || y < -margin || y > H + margin) { s = false; continue; }
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = COLORS.routeUpcoming; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();

    // Traveled (glowy terracotta)
    ctx.beginPath(); s = false;
    for (let i = 0; i <= csi && i < sampled.length; i++) {
        const { x, y } = geoToPixel(sampled[i].lat, sampled[i].lon, current.lat, current.lon, W, H);
        if (x < -margin || x > W + margin || y < -margin || y > H + margin) { s = false; continue; }
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = COLORS.routeGlowOuter; ctx.lineWidth = 14; ctx.stroke();
    ctx.strokeStyle = COLORS.routeGlow; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = COLORS.routeTraveled; ctx.lineWidth = 3; ctx.stroke();

    // Position marker
    const px = W / 2, py = H / 2;
    const pulse = Math.sin(frameNum * 0.15) * 0.3 + 1.0;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, 25 * pulse);
    grad.addColorStop(0, "rgba(204, 120, 92, 0.6)");
    grad.addColorStop(0.5, "rgba(204, 120, 92, 0.2)");
    grad.addColorStop(1, "rgba(204, 120, 92, 0)");
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(px, py, 25 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.positionDot; ctx.fill();
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2.5; ctx.stroke();

    // Stats
    const avgSpeed = rollingAvg(points, current.elapsedTime, "speed");
    const avgEle = rollingAvg(points, current.elapsedTime, "ele");

    // HUD background
    const hudH = Math.round(H * 0.105), hudY = H - hudH - Math.round(H * 0.022);
    const hudX = Math.round(W * 0.028), hudW = W - hudX * 2;
    const r = Math.round(W * 0.022);
    ctx.beginPath();
    ctx.moveTo(hudX + r, hudY); ctx.lineTo(hudX + hudW - r, hudY);
    ctx.quadraticCurveTo(hudX + hudW, hudY, hudX + hudW, hudY + r);
    ctx.lineTo(hudX + hudW, hudY + hudH - r);
    ctx.quadraticCurveTo(hudX + hudW, hudY + hudH, hudX + hudW - r, hudY + hudH);
    ctx.lineTo(hudX + r, hudY + hudH);
    ctx.quadraticCurveTo(hudX, hudY + hudH, hudX, hudY + hudH - r);
    ctx.lineTo(hudX, hudY + r);
    ctx.quadraticCurveTo(hudX, hudY, hudX + r, hudY);
    ctx.closePath();
    ctx.fillStyle = COLORS.hudBg; ctx.fill();
    ctx.strokeStyle = COLORS.hudBorder; ctx.lineWidth = 1; ctx.stroke();

    // HUD cells (2x2)
    const colW = hudW / 2, rowH = hudH / 2, pad = Math.round(W * 0.028);
    const labelSize = Math.round(W * 0.012), valueSize = Math.round(W * 0.037), unitSize = Math.round(W * 0.017);
    const cells = [
        { label: "SPEED", value: `${Math.round(avgSpeed)}`, unit: "km/h", col: 0, row: 0 },
        { label: "DISTANCE", value: formatDist(current.distance), unit: "", col: 1, row: 0 },
        { label: "ELEVATION", value: `${Math.round(avgEle)} m`, unit: "", col: 0, row: 1 },
        { label: "TIME", value: formatDur(current.elapsedTime), unit: "", col: 1, row: 1 },
    ];
    for (const c of cells) {
        const cx = hudX + c.col * colW + pad, cy = hudY + c.row * rowH + Math.round(hudH * 0.08);
        ctx.fillStyle = COLORS.label; ctx.font = `600 ${labelSize}px sans-serif`; ctx.textAlign = "left";
        ctx.fillText(c.label, cx, cy + labelSize + 2);
        ctx.fillStyle = COLORS.text; ctx.font = `bold ${valueSize}px sans-serif`;
        ctx.fillText(c.value, cx, cy + labelSize + valueSize + 6);
        if (c.unit) {
            const vw = ctx.measureText(c.value).width;
            ctx.fillStyle = COLORS.label; ctx.font = `600 ${unitSize}px sans-serif`;
            ctx.fillText(` ${c.unit}`, cx + vw, cy + labelSize + valueSize + 6);
        }
    }

    // Progress bar
    const barY = H - Math.round(H * 0.01), barH = Math.round(H * 0.002);
    ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(hudX, barY, hudW, barH);
    ctx.fillStyle = COLORS.accent; ctx.fillRect(hudX, barY, hudW * (current.elapsedTime / totalRealTime), barH);
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────
const VideoGenerator = ({ open, onOpenChange, points, title }: VideoGeneratorProps) => {
    const [resolution, setResolution] = useState(1); // 1080p default
    const [phase, setPhase] = useState<"idle" | "prefetch" | "preview" | "generating" | "done">("idle");
    const [progress, setProgress] = useState(0);
    const [frameInfo, setFrameInfo] = useState("");
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);
    const abortRef = useRef(false);

    const computed = useRef<ComputedPoint[]>([]);

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

    // Start preview when phase is preview
    useEffect(() => {
        if (phase !== "preview") return;
        const pts = computed.current;
        if (pts.length === 0) return;
        const canvas = previewCanvasRef.current;
        if (!canvas) return;

        const totalRealTime = pts[pts.length - 1].elapsedTime;
        const ctx = canvas.getContext("2d")!;
        const W = canvas.width, H = canvas.height;
        let frame = 0;

        const animate = () => {
            if (abortRef.current) return;
            const realTime = (frame / FPS) * SPEED_MULTIPLIER;
            if (realTime > totalRealTime) frame = 0; // loop

            const current = interpolateAtTime(pts, (frame / FPS) * SPEED_MULTIPLIER);
            if (current) {
                let lo = 0, hi = pts.length - 1;
                while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].elapsedTime < (frame / FPS) * SPEED_MULTIPLIER) lo = mid + 1; else hi = mid; }
                renderFrame(ctx, W, H, pts, lo, current, frame, totalRealTime);
            }
            frame++;
            animFrameRef.current = requestAnimationFrame(animate);
        };
        animate();
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [phase]);

    const startPreview = useCallback(async () => {
        const pts = computed.current;
        if (pts.length === 0) return;
        setPhase("prefetch");
        await prefetchTiles(pts, (p) => setProgress(p));
        setProgress(0);
        setPhase("preview");
    }, []);

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
        const videoSeconds = totalRealTime / SPEED_MULTIPLIER;
        const totalFrames = Math.ceil(videoSeconds * FPS);
        const startedAt = performance.now();
        console.log(`🎬 Starting encode: ${totalFrames} frames, ${RESOLUTIONS[resolution].label}, ${Math.round(videoSeconds)}s video`);

        // Canvas for rendering
        const offscreen = new OffscreenCanvas(W, H);
        const ctx = offscreen.getContext("2d")!;

        // mp4-muxer setup
        const muxerTarget = new ArrayBufferTarget();
        const muxer = new Muxer({
            target: muxerTarget,
            video: {
                codec: "avc",
                width: W,
                height: H,
            },
            fastStart: "in-memory",
        });

        // WebCodecs VideoEncoder
        const encoder = new VideoEncoder({
            output: (chunk, meta) => {
                muxer.addVideoChunk(chunk, meta);
            },
            error: (e) => console.error("VideoEncoder error:", e),
        });

        encoder.configure({
            codec: "avc1.42001E",
            width: W,
            height: H,
            bitrate: W > 1500 ? 8_000_000 : 4_000_000,
            framerate: FPS,
        });

        // Render & encode frames
        for (let frame = 0; frame < totalFrames; frame++) {
            if (abortRef.current) { encoder.close(); return; }

            const realTime = (frame / FPS) * SPEED_MULTIPLIER;
            const current = interpolateAtTime(pts, realTime);
            if (!current) continue;

            let lo = 0, hi = pts.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].elapsedTime < realTime) lo = mid + 1; else hi = mid; }

            renderFrame(ctx, W, H, pts, lo, current, frame, totalRealTime);

            const vf = new VideoFrame(offscreen, { timestamp: (frame / FPS) * 1_000_000, duration: (1 / FPS) * 1_000_000 });
            const isKeyFrame = frame % (FPS * 2) === 0; // keyframe every 2s
            encoder.encode(vf, { keyFrame: isKeyFrame });
            vf.close();

            // Backpressure: don't get too far ahead of the encoder
            if (encoder.encodeQueueSize > 5) {
                await new Promise<void>(res => { const check = () => { if (encoder.encodeQueueSize <= 2) res(); else setTimeout(check, 5); }; check(); });
            }

            if (frame % 5 === 0) {
                setProgress(frame / totalFrames);
                setFrameInfo(`Frame ${frame}/${totalFrames}`);
                if (frame % 100 === 0) {
                    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
                    const fps = frame > 0 ? (frame / ((performance.now() - startedAt) / 1000)).toFixed(1) : '0';
                    console.log(`📊 Frame ${frame}/${totalFrames} (${Math.round(frame / totalFrames * 100)}%) — ${elapsed}s elapsed, ${fps} fps`);
                }
                await new Promise(r => setTimeout(r, 0)); // yield to UI
            }
        }

        await encoder.flush();
        encoder.close();
        muxer.finalize();

        const totalTime = ((performance.now() - startedAt) / 1000).toFixed(1);
        console.log(`✅ Encode complete: ${totalFrames} frames in ${totalTime}s (${(totalFrames / parseFloat(totalTime)).toFixed(1)} fps avg)`);

        const blob = new Blob([muxerTarget.buffer], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setPhase("done");
        setProgress(1);
    }, [resolution]);

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

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Film className="w-5 h-5 text-primary" />
                        Generate Video
                    </DialogTitle>
                    <DialogDescription>
                        Create a timelapse video of this drive at 30× speed. Processing happens entirely on your device.
                    </DialogDescription>
                </DialogHeader>

                {/* Resolution Picker */}
                <div className="flex gap-2">
                    {RESOLUTIONS.map((r, i) => (
                        <button
                            key={r.label}
                            onClick={() => phase === "idle" && setResolution(i)}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all border ${i === resolution
                                ? "bg-primary text-primary-foreground border-primary shadow"
                                : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/60"
                                }`}
                            disabled={phase !== "idle"}
                        >
                            {r.label}
                            <span className="block text-[10px] opacity-60 font-normal">{r.w}×{r.h}</span>
                        </button>
                    ))}
                </div>

                {/* Preview / Progress Area */}
                <div
                    className="relative w-full rounded-xl overflow-hidden border border-border bg-black flex items-center justify-center"
                    style={{ aspectRatio: `${res.w} / ${res.h}`, maxHeight: 400 }}
                >
                    {phase === "idle" && (
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                            <Play className="w-10 h-10 opacity-40" />
                            <span className="text-xs">Click Preview to see a sample</span>
                        </div>
                    )}

                    {phase === "prefetch" && (
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span className="text-xs">Loading map tiles... {Math.round(progress * 100)}%</span>
                        </div>
                    )}

                    {(phase === "preview" || phase === "generating" || phase === "done") && (
                        <canvas
                            ref={previewCanvasRef}
                            width={previewW}
                            height={previewH}
                            className="w-full h-full object-contain"
                        />
                    )}

                    {phase === "generating" && (
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <span className="text-white text-sm font-semibold">{Math.round(progress * 100)}%</span>
                            <span className="text-white/50 text-[10px]">{frameInfo || `Starting ${RESOLUTIONS[resolution].label} encode...`}</span>
                        </div>
                    )}

                    {phase === "done" && (
                        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-3">
                            <span className="text-white text-sm font-semibold">✅ Video Ready</span>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                    {phase === "idle" && (
                        <Button onClick={startPreview} className="flex-1 gap-2">
                            <Play className="w-4 h-4" /> Preview
                        </Button>
                    )}

                    {phase === "preview" && (
                        <Button onClick={generateVideo} className="flex-1 gap-2">
                            <Film className="w-4 h-4" /> Generate {RESOLUTIONS[resolution].label} Video
                        </Button>
                    )}

                    {phase === "generating" && (
                        <Button variant="destructive" onClick={() => { abortRef.current = true; setPhase("preview"); }} className="flex-1 gap-2">
                            <X className="w-4 h-4" /> Cancel
                        </Button>
                    )}

                    {phase === "done" && blobUrl && (
                        <a href={blobUrl} download={`${title}_30x.mp4`} className="flex-1">
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
