#!/usr/bin/env npx tsx

/**
 * generate-video.ts
 *
 * Generates an MP4 video from a GPX file.
 * - Map tiles from CARTO (dark mode)
 * - Glowy blue route with traveled portion
 * - Current position marker
 * - Stats HUD: speed, distance, elevation, time (30s rolling averages)
 * - 30× real-time speed
 *
 * Usage: npx tsx scripts/generate-video.ts <gpx-file> [output.mp4]
 */

import { createCanvas, loadImage, registerFont, type Canvas, type CanvasRenderingContext2D, type Image } from 'canvas';
import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const WIDTH = 1080;              // Instagram-reel / portrait-friendly
const HEIGHT = 1920;
const FPS = 30;
const SPEED_MULTIPLIER = 30;     // 30× real-time
const TILE_SIZE = 256;
const ZOOM = 16;                 // Map zoom level
const TILE_URL = 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
const TILE_CACHE_DIR = path.join(__dirname, '.tile-cache');

// HUD Colors
const HUD_BG = 'rgba(10, 10, 20, 0.85)';
const HUD_TEXT = '#ffffff';
const HUD_LABEL = 'rgba(255, 255, 255, 0.5)';
const HUD_ACCENT = '#3b82f6'; // Blue accent

// Route colors
const ROUTE_UPCOMING_COLOR = 'rgba(59, 130, 246, 0.15)';  // Very faint blue
const ROUTE_TRAVELED_COLOR = '#3b82f6';                     // Bright blue
const ROUTE_GLOW_COLOR = 'rgba(59, 130, 246, 0.4)';        // Glow
const ROUTE_GLOW_OUTER = 'rgba(59, 130, 246, 0.15)';       // Outer glow
const POSITION_DOT_COLOR = '#ffffff';
const POSITION_GLOW_COLOR = 'rgba(59, 130, 246, 0.6)';

// Rolling average window for stats (in real-time seconds)
const ROLLING_WINDOW_SECONDS = 30;

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface GPXPoint {
    lat: number;
    lon: number;
    ele: number;
    time: Date;
}

interface ComputedPoint extends GPXPoint {
    speed: number;        // km/h (instantaneous)
    distance: number;     // cumulative km
    elapsedTime: number;  // seconds from start
}

// ─── HAVERSINE ────────────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── GPX PARSING (Node-compatible) ────────────────────────────────────────────
function parseGPX(filePath: string): GPXPoint[] {
    const xml = fs.readFileSync(filePath, 'utf-8');
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
    });
    const parsed = parser.parse(xml);

    const trk = parsed.gpx?.trk;
    if (!trk) throw new Error('No <trk> found in GPX');

    const trksegs = Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg];
    const points: GPXPoint[] = [];

    for (const seg of trksegs) {
        const trkpts = Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt];
        for (const pt of trkpts) {
            points.push({
                lat: parseFloat(pt['@_lat']),
                lon: parseFloat(pt['@_lon']),
                ele: pt.ele !== undefined ? parseFloat(pt.ele) : 0,
                time: new Date(pt.time),
            });
        }
    }

    return points;
}

// ─── COMPUTE PER-POINT DATA ───────────────────────────────────────────────────
function computePoints(raw: GPXPoint[]): ComputedPoint[] {
    if (raw.length === 0) return [];

    const startTime = raw[0].time.getTime();
    const result: ComputedPoint[] = [];
    let cumDist = 0;

    for (let i = 0; i < raw.length; i++) {
        const p = raw[i];
        const elapsed = (p.time.getTime() - startTime) / 1000;

        let speed = 0;
        if (i > 0) {
            const prev = raw[i - 1];
            const d = haversine(prev.lat, prev.lon, p.lat, p.lon);
            const dt = (p.time.getTime() - prev.time.getTime()) / 1000;
            cumDist += d;
            if (dt > 0 && dt < 60) { // Skip pauses > 60s
                speed = (d / dt) * 3600; // km/h
                if (speed > 200) speed = 0; // Sanity cap
            }
        }

        result.push({ ...p, speed, distance: cumDist, elapsedTime: elapsed });
    }

    return result;
}

// ─── INTERPOLATION ────────────────────────────────────────────────────────────
function interpolateAtTime(points: ComputedPoint[], realTime: number): ComputedPoint | null {
    if (points.length === 0) return null;
    if (realTime <= points[0].elapsedTime) return points[0];
    if (realTime >= points[points.length - 1].elapsedTime) return points[points.length - 1];

    // Binary search for the right segment
    let lo = 0, hi = points.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (points[mid].elapsedTime <= realTime) lo = mid;
        else hi = mid;
    }

    const a = points[lo];
    const b = points[hi];
    const dt = b.elapsedTime - a.elapsedTime;
    const t = dt > 0 ? (realTime - a.elapsedTime) / dt : 0;

    return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        ele: a.ele + (b.ele - a.ele) * t,
        time: new Date(a.time.getTime() + (b.time.getTime() - a.time.getTime()) * t),
        speed: a.speed + (b.speed - a.speed) * t,
        distance: a.distance + (b.distance - a.distance) * t,
        elapsedTime: realTime,
    };
}

// ─── ROLLING AVERAGE ──────────────────────────────────────────────────────────
function rollingAverage(points: ComputedPoint[], currentTime: number, key: keyof ComputedPoint, windowSec: number): number {
    const windowStart = Math.max(0, currentTime - windowSec);
    let sum = 0, count = 0;

    for (const p of points) {
        if (p.elapsedTime >= windowStart && p.elapsedTime <= currentTime) {
            const val = p[key];
            if (typeof val === 'number') {
                sum += val;
                count++;
            }
        }
        if (p.elapsedTime > currentTime) break;
    }

    return count > 0 ? sum / count : 0;
}

// ─── TILE MATH ────────────────────────────────────────────────────────────────
function lonToTileX(lon: number, zoom: number): number {
    return ((lon + 180) / 360) * (1 << zoom);
}

function latToTileY(lat: number, zoom: number): number {
    const latRad = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * (1 << zoom);
}

// Convert lat/lon to pixel coordinates relative to canvas center
function geoToPixel(lat: number, lon: number, centerLat: number, centerLon: number): { x: number; y: number } {
    const centerTileX = lonToTileX(centerLon, ZOOM);
    const centerTileY = latToTileY(centerLat, ZOOM);
    const tileX = lonToTileX(lon, ZOOM);
    const tileY = latToTileY(lat, ZOOM);

    const px = (tileX - centerTileX) * TILE_SIZE + WIDTH / 2;
    const py = (tileY - centerTileY) * TILE_SIZE + HEIGHT / 2;
    return { x: px, y: py };
}

// ─── TILE FETCHING ────────────────────────────────────────────────────────────
function fetchTile(z: number, x: number, y: number): Promise<Buffer> {
    const cacheFile = path.join(TILE_CACHE_DIR, `${z}_${x}_${y}.png`);

    if (fs.existsSync(cacheFile)) {
        return Promise.resolve(fs.readFileSync(cacheFile));
    }

    const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'AnalyseDrive-VideoGen/1.0' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                // Follow redirect
                const redirectUrl = res.headers.location!;
                const redirectClient = redirectUrl.startsWith('https') ? https : http;
                redirectClient.get(redirectUrl, { headers: { 'User-Agent': 'AnalyseDrive-VideoGen/1.0' } }, (res2) => {
                    const chunks: Buffer[] = [];
                    res2.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res2.on('end', () => {
                        const data = Buffer.concat(chunks);
                        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
                        fs.writeFileSync(cacheFile, data);
                        resolve(data);
                    });
                    res2.on('error', reject);
                }).on('error', reject);
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const data = Buffer.concat(chunks);
                fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
                fs.writeFileSync(cacheFile, data);
                resolve(data);
            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

// ─── IN-MEMORY TILE IMAGE CACHE ───────────────────────────────────────────────
const tileImageCache = new Map<string, Image>();

async function getOrLoadTileImage(z: number, x: number, y: number): Promise<Image | null> {
    const key = `${z}_${x}_${y}`;
    const cached = tileImageCache.get(key);
    if (cached) return cached;

    try {
        const buf = await fetchTile(z, x, y);
        if (buf.length === 0) return null;
        const img = await loadImage(buf);
        tileImageCache.set(key, img);
        return img;
    } catch {
        return null;
    }
}

// ─── RENDER MAP TILES ─────────────────────────────────────────────────────────
function renderMapTiles(ctx: CanvasRenderingContext2D, centerLat: number, centerLon: number): void {
    const centerTileXf = lonToTileX(centerLon, ZOOM);
    const centerTileYf = latToTileY(centerLat, ZOOM);

    // How many tiles needed to fill the canvas
    const tilesNeededX = Math.ceil(WIDTH / TILE_SIZE) + 2;
    const tilesNeededY = Math.ceil(HEIGHT / TILE_SIZE) + 2;

    const centerTileX = Math.floor(centerTileXf);
    const centerTileY = Math.floor(centerTileYf);

    const offsetX = (centerTileXf - centerTileX) * TILE_SIZE;
    const offsetY = (centerTileYf - centerTileY) * TILE_SIZE;

    const halfX = Math.ceil(tilesNeededX / 2);
    const halfY = Math.ceil(tilesNeededY / 2);

    for (let dx = -halfX; dx <= halfX; dx++) {
        for (let dy = -halfY; dy <= halfY; dy++) {
            const tx = centerTileX + dx;
            const ty = centerTileY + dy;
            const img = tileImageCache.get(`${ZOOM}_${tx}_${ty}`);
            if (!img) continue;
            const drawX = WIDTH / 2 + (dx * TILE_SIZE) - offsetX;
            const drawY = HEIGHT / 2 + (dy * TILE_SIZE) - offsetY;
            ctx.drawImage(img, drawX, drawY, TILE_SIZE, TILE_SIZE);
        }
    }
}

// ─── DRAW ROUTE ───────────────────────────────────────────────────────────────
function drawRoute(
    ctx: CanvasRenderingContext2D,
    points: ComputedPoint[],
    currentIdx: number,
    centerLat: number,
    centerLon: number
): void {
    if (points.length < 2) return;

    // Downsample for performance — pick every Nth point
    const step = Math.max(1, Math.floor(points.length / 2000));
    const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    const currentSampleIdx = Math.floor(currentIdx / step);

    // Convert to pixel coords
    const pixels = sampled.map(p => geoToPixel(p.lat, p.lon, centerLat, centerLon));

    // Filter to visible points (within generous bounds)
    const margin = 200;

    // === UPCOMING ROUTE (thin, faint) ===
    ctx.beginPath();
    let started = false;
    for (let i = currentSampleIdx; i < pixels.length; i++) {
        const { x, y } = pixels[i];
        if (x < -margin || x > WIDTH + margin || y < -margin || y > HEIGHT + margin) {
            started = false;
            continue;
        }
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = ROUTE_UPCOMING_COLOR;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // === TRAVELED ROUTE (glowy blue) ===
    // Outer glow
    ctx.beginPath();
    started = false;
    for (let i = 0; i <= currentSampleIdx && i < pixels.length; i++) {
        const { x, y } = pixels[i];
        if (x < -margin || x > WIDTH + margin || y < -margin || y > HEIGHT + margin) {
            started = false;
            continue;
        }
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = ROUTE_GLOW_OUTER;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Middle glow
    ctx.strokeStyle = ROUTE_GLOW_COLOR;
    ctx.lineWidth = 8;
    ctx.stroke();

    // Core line
    ctx.strokeStyle = ROUTE_TRAVELED_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
}

// ─── DRAW POSITION MARKER ─────────────────────────────────────────────────────
function drawPositionMarker(ctx: CanvasRenderingContext2D, x: number, y: number, frameNum: number): void {
    // Pulsing animation
    const pulse = Math.sin(frameNum * 0.15) * 0.3 + 1.0;

    // Outer glow pulse
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 25 * pulse);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.6)');
    gradient.addColorStop(0.5, 'rgba(59, 130, 246, 0.2)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 25 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // White dot with blue border
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = POSITION_DOT_COLOR;
    ctx.fill();
    ctx.strokeStyle = HUD_ACCENT;
    ctx.lineWidth = 2.5;
    ctx.stroke();
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────
function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSpeed(kmh: number): string {
    return `${Math.round(kmh)}`;
}

function formatDistance(km: number): string {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
}

function formatElevation(m: number): string {
    return `${Math.round(m)} m`;
}

// ─── DRAW HUD ─────────────────────────────────────────────────────────────────
function drawHUD(
    ctx: CanvasRenderingContext2D,
    speed: number,
    distance: number,
    elevation: number,
    elapsed: number,
): void {
    const hudHeight = 200;
    const hudY = HEIGHT - hudHeight - 40;
    const hudX = 30;
    const hudW = WIDTH - 60;

    // Background with rounded corners
    ctx.save();
    const radius = 24;
    ctx.beginPath();
    ctx.moveTo(hudX + radius, hudY);
    ctx.lineTo(hudX + hudW - radius, hudY);
    ctx.quadraticCurveTo(hudX + hudW, hudY, hudX + hudW, hudY + radius);
    ctx.lineTo(hudX + hudW, hudY + hudHeight - radius);
    ctx.quadraticCurveTo(hudX + hudW, hudY + hudHeight, hudX + hudW - radius, hudY + hudHeight);
    ctx.lineTo(hudX + radius, hudY + hudHeight);
    ctx.quadraticCurveTo(hudX, hudY + hudHeight, hudX, hudY + hudHeight - radius);
    ctx.lineTo(hudX, hudY + radius);
    ctx.quadraticCurveTo(hudX, hudY, hudX + radius, hudY);
    ctx.closePath();
    ctx.fillStyle = HUD_BG;
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Layout: 2×2 grid
    const colW = hudW / 2;
    const rowH = hudHeight / 2;
    const padding = 30;

    const cells = [
        { label: 'SPEED', value: formatSpeed(speed), unit: 'km/h', col: 0, row: 0 },
        { label: 'DISTANCE', value: formatDistance(distance), unit: '', col: 1, row: 0 },
        { label: 'ELEVATION', value: formatElevation(elevation), unit: '', col: 0, row: 1 },
        { label: 'TIME', value: formatDuration(elapsed), unit: '', col: 1, row: 1 },
    ];

    for (const cell of cells) {
        const cx = hudX + cell.col * colW + padding;
        const cy = hudY + cell.row * rowH + 15;

        // Label
        ctx.fillStyle = HUD_LABEL;
        ctx.font = '600 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(cell.label, cx, cy + 18);

        // Value
        ctx.fillStyle = HUD_TEXT;
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(cell.value, cx, cy + 65);

        // Unit (inline)
        if (cell.unit) {
            const valueWidth = ctx.measureText(cell.value).width;
            ctx.fillStyle = HUD_LABEL;
            ctx.font = '600 18px sans-serif';
            ctx.fillText(` ${cell.unit}`, cx + valueWidth, cy + 65);
        }
    }
}

// ─── DRAW PROGRESS BAR ───────────────────────────────────────────────────────
function drawProgressBar(ctx: CanvasRenderingContext2D, progress: number): void {
    const barY = HEIGHT - 20;
    const barH = 4;
    const barX = 30;
    const barW = WIDTH - 60;

    // BG
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(barX, barY, barW, barH);

    // Fill
    ctx.fillStyle = HUD_ACCENT;
    ctx.fillRect(barX, barY, barW * progress, barH);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: npx tsx scripts/generate-video.ts <gpx-file> [output.mp4]');
        process.exit(1);
    }

    const gpxFile = args[0];
    const outputFile = args[1] || gpxFile.replace(/\.gpx$/i, '_video.mp4');

    console.log(`📂 Reading GPX: ${gpxFile}`);
    const rawPoints = parseGPX(gpxFile);
    console.log(`   ${rawPoints.length} trackpoints`);

    const points = computePoints(rawPoints);
    const totalRealTime = points[points.length - 1].elapsedTime;
    const videoSeconds = totalRealTime / SPEED_MULTIPLIER;
    const totalFrames = Math.ceil(videoSeconds * FPS);

    console.log(`⏱  Total real time: ${formatDuration(totalRealTime)}`);
    console.log(`🎬 Video duration: ${formatDuration(videoSeconds)} (${totalFrames} frames @ ${FPS}fps, ${SPEED_MULTIPLIER}× speed)`);
    console.log(`📁 Output: ${outputFile}`);

    // Ensure cache dir
    fs.mkdirSync(TILE_CACHE_DIR, { recursive: true });

    // Start ffmpeg
    const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-s', `${WIDTH}x${HEIGHT}`,
        '-r', String(FPS),
        '-i', '-',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '23',
        '-movflags', '+faststart',
        outputFile,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    ffmpeg.stderr?.on('data', (data: Buffer) => {
        // Only log important ffmpeg output
        const msg = data.toString();
        if (msg.includes('frame=') || msg.includes('Error') || msg.includes('error')) {
            process.stderr.write(`  ffmpeg: ${msg}`);
        }
    });

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Pre-fetch unique tiles and load into memory
    console.log('🗺  Pre-fetching and loading map tiles into memory...');
    const uniqueTiles = new Set<string>();
    for (const p of points) {
        const tx = Math.floor(lonToTileX(p.lon, ZOOM));
        const ty = Math.floor(latToTileY(p.lat, ZOOM));
        // Add surrounding tiles
        for (let dx = -3; dx <= 3; dx++) {
            for (let dy = -5; dy <= 5; dy++) {
                uniqueTiles.add(`${ZOOM}_${tx + dx}_${ty + dy}`);
            }
        }
    }
    console.log(`   ${uniqueTiles.size} unique tiles to fetch & load`);

    // Fetch and load in batches
    const tileKeys = Array.from(uniqueTiles);
    const BATCH_SIZE = 50;
    for (let i = 0; i < tileKeys.length; i += BATCH_SIZE) {
        const batch = tileKeys.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(key => {
            const [z, x, y] = key.split('_').map(Number);
            return getOrLoadTileImage(z, x, y).catch(() => { });
        }));
        if (i % 100 === 0) {
            process.stdout.write(`\r   Loaded ${Math.min(i + BATCH_SIZE, tileKeys.length)}/${tileKeys.length} tiles`);
        }
    }
    console.log(`\n   ✅ ${tileImageCache.size} tiles loaded into memory`);

    // Find the point index corresponding to a real time
    function findPointIndex(realTime: number): number {
        let lo = 0, hi = points.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (points[mid].elapsedTime < realTime) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // Render frames
    console.log('🎨 Rendering frames...');
    let lastLogTime = Date.now();

    for (let frame = 0; frame < totalFrames; frame++) {
        const realTime = (frame / FPS) * SPEED_MULTIPLIER;
        const current = interpolateAtTime(points, realTime);
        if (!current) continue;

        const currentIdx = findPointIndex(realTime);

        // Rolling averages
        const avgSpeed = rollingAverage(points, realTime, 'speed', ROLLING_WINDOW_SECONDS);
        const avgEle = rollingAverage(points, realTime, 'ele', ROLLING_WINDOW_SECONDS);

        // Clear canvas
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // Render map tiles (synchronous — all tiles pre-loaded)
        renderMapTiles(ctx, current.lat, current.lon);

        // Draw route
        drawRoute(ctx, points, currentIdx, current.lat, current.lon);

        // Draw position
        const pos = geoToPixel(current.lat, current.lon, current.lat, current.lon);
        drawPositionMarker(ctx, pos.x, pos.y, frame);

        // Draw HUD
        drawHUD(ctx, avgSpeed, current.distance, avgEle, current.elapsedTime);

        // Draw progress bar
        drawProgressBar(ctx, realTime / totalRealTime);

        // Write frame to ffmpeg
        const frameBuffer = canvas.toBuffer('raw');
        const canWrite = ffmpeg.stdin!.write(frameBuffer);
        if (!canWrite) {
            await new Promise<void>(resolve => ffmpeg.stdin!.once('drain', resolve));
        }

        // Progress logging
        if (Date.now() - lastLogTime > 2000) {
            const pct = ((frame / totalFrames) * 100).toFixed(1);
            process.stdout.write(`\r   Frame ${frame}/${totalFrames} (${pct}%)`);
            lastLogTime = Date.now();
        }
    }

    console.log(`\r   Frame ${totalFrames}/${totalFrames} (100.0%)`);

    // Close ffmpeg
    ffmpeg.stdin!.end();

    await new Promise<void>((resolve, reject) => {
        ffmpeg.on('close', (code: number) => {
            if (code === 0) {
                console.log(`\n✅ Video saved to: ${outputFile}`);
                resolve();
            } else {
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });
    });
}

main().catch(err => {
    console.error('❌ Error:', err.message || err);
    process.exit(1);
});
