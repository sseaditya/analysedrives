import {
  GPXPoint,
  GPXStats,
  formatDistance,
  formatDurationShort,
  formatSpeed,
  haversineDistance,
} from "@/utils/gpxParser";

interface ShareImageOptions {
  title: string;
  points: GPXPoint[];
  stats: GPXStats;
  hideRadius?: number | null;
  userName?: string | null;
  carName?: string | null;
  theme?: "light" | "dark";
}

type Rect = { x: number; y: number; width: number; height: number };

const WIDTH = 1080;
const HEIGHT = 1920;
const TILE_SIZE = 256;
const TOP_SQUARE = { x: 0, y: 0, width: 1080, height: 1080 };
const ROUTE_SQUARE = { x: 86, y: 86, width: 908, height: 908 };

const sanitizeFileName = (name: string) =>
  name
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "activity";

export const getPrivacyClippedPoints = (points: GPXPoint[], hideRadius?: number | null): GPXPoint[] => {
  if (!hideRadius || hideRadius <= 0 || points.length < 2) return points;

  let cumulativeDist = 0;
  let startIndex = 0;
  let endIndex = points.length - 1;

  for (let i = 1; i < points.length; i++) {
    cumulativeDist += haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    if (cumulativeDist >= hideRadius) {
      startIndex = i;
      break;
    }
  }

  cumulativeDist = 0;
  for (let i = points.length - 2; i >= 0; i--) {
    cumulativeDist += haversineDistance(points[i].lat, points[i].lon, points[i + 1].lat, points[i + 1].lon);
    if (cumulativeDist >= hideRadius) {
      endIndex = i;
      break;
    }
  }

  if (startIndex >= endIndex) return [];
  return points.slice(startIndex, endIndex + 1);
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

const drawWrappedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);

  lines.slice(0, maxLines).forEach((item, index) => {
    const suffix = index === maxLines - 1 && lines.length > maxLines ? "..." : "";
    ctx.fillText(`${item}${suffix}`, x, y + index * lineHeight);
  });
};

const projectRoute = (points: GPXPoint[], bounds: Rect) => {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const lonRange = Math.max(maxLon - minLon, 0.000001);
  const latRange = Math.max(maxLat - minLat, 0.000001);
  const routeRatio = lonRange / latRange;
  const boxRatio = bounds.width / bounds.height;

  let drawWidth = bounds.width;
  let drawHeight = bounds.height;
  if (routeRatio > boxRatio) {
    drawHeight = bounds.width / routeRatio;
  } else {
    drawWidth = bounds.height * routeRatio;
  }

  const offsetX = bounds.x + (bounds.width - drawWidth) / 2;
  const offsetY = bounds.y + (bounds.height - drawHeight) / 2;

  return points.map((p) => ({
    x: offsetX + ((p.lon - minLon) / lonRange) * drawWidth,
    y: offsetY + (1 - (p.lat - minLat) / latRange) * drawHeight,
  }));
};

const getSegmentSpeeds = (points: GPXPoint[]) =>
  points.slice(1).map((point, index) => {
    const previous = points[index];
    if (!previous.time || !point.time) return 0;
    const hours = (point.time.getTime() - previous.time.getTime()) / 1000 / 3600;
    if (hours <= 0) return 0;
    const speed = haversineDistance(previous.lat, previous.lon, point.lat, point.lon) / hours;
    return Number.isFinite(speed) && speed <= 260 ? speed : 0;
  });

const getSpeedColor = (speed: number) => {
  const ratio = Math.max(0, Math.min(speed / 150, 1));
  const lightness = 90 - ratio * 65;
  return `hsl(215, 95%, ${lightness.toFixed(1)}%)`;
};

const buildSpeedSegments = (points: GPXPoint[], route: { x: number; y: number }[]) => {
  const speeds = getSegmentSpeeds(points);
  return speeds.map((speed, index) => ({
    start: route[index],
    end: route[index + 1],
    speed,
    color: getSpeedColor(speed),
  })).filter((segment) => segment.start && segment.end);
};

const drawSpeedCodedRoute = (
  ctx: CanvasRenderingContext2D,
  points: GPXPoint[],
  route: { x: number; y: number }[],
) => {
  if (route.length < 2) return;

  const strokePath = () => {
    ctx.beginPath();
    ctx.moveTo(route[0].x, route[0].y);
    for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y);
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.shadowColor = "rgba(30, 64, 175, 0.45)";
  ctx.shadowBlur = 24;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = 18;
  strokePath();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 10;
  buildSpeedSegments(points, route).forEach((segment) => {
    ctx.beginPath();
    ctx.strokeStyle = segment.color;
    ctx.moveTo(segment.start.x, segment.start.y);
    ctx.lineTo(segment.end.x, segment.end.y);
    ctx.stroke();
  });

  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  strokePath();
  ctx.stroke();
  ctx.globalAlpha = 1;

  const start = route[0];
  const end = route[route.length - 1];
  [
    { point: start, color: "#34d399" },
    { point: end, color: "#f87171" },
  ].forEach(({ point, color }) => {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  });

  ctx.restore();
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatShareStats = (stats: GPXStats) => [
  { label: "Distance", value: formatDistance(stats.totalDistance) },
  { label: "Elapsed time", value: formatDurationShort(stats.totalTime || stats.movingTime) },
  { label: "Avg speed", value: formatSpeed(stats.avgSpeed || stats.movingAvgSpeed) },
];

const getDisplayName = (userName?: string | null) => userName?.trim() || "Driver";
const getCarName = (carName?: string | null) => carName?.trim() || "Car";

const toRoutePath = (route: { x: number; y: number }[]) =>
  route.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");

const toSpeedSegmentMarkup = (points: GPXPoint[], route: { x: number; y: number }[]) =>
  buildSpeedSegments(points, route).map((segment) => `
  <path d="M ${segment.start.x.toFixed(1)} ${segment.start.y.toFixed(1)} L ${segment.end.x.toFixed(1)} ${segment.end.y.toFixed(1)}" fill="none" stroke="${segment.color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`).join("");

export const createTransparentRouteShareSvg = async ({
  title,
  points,
  stats,
  hideRadius,
  userName,
  carName,
}: ShareImageOptions): Promise<File> => {
  const visiblePoints = getPrivacyClippedPoints(points, hideRadius);
  const route = visiblePoints.length >= 2
    ? projectRoute(visiblePoints, ROUTE_SQUARE)
    : [];
  const routePath = toRoutePath(route);
  const speedSegments = toSpeedSegmentMarkup(visiblePoints, route);
  const statCards = formatShareStats(stats);
  const safeTitle = escapeXml(title);
  const safeUserName = escapeXml(getDisplayName(userName));
  const safeCarName = escapeXml(getCarName(carName));

  const statsMarkup = statCards.map((stat, index) => {
    const x = 78 + index * 335;
    return `
      <g transform="translate(${x} 1610)">
        <text x="0" y="0" fill="rgba(255,255,255,0.7)" font-size="29" font-weight="600">${escapeXml(stat.label)}</text>
        <text x="0" y="62" fill="#ffffff" font-size="45" font-weight="750">${escapeXml(stat.value)}</text>
      </g>`;
  }).join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.38"/>
    </filter>
    <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="#1d4ed8" flood-opacity="0.48"/>
    </filter>
  </defs>
  <g font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" filter="url(#softShadow)">
    <text x="78" y="1236" fill="#ffffff" font-size="62" font-weight="800">${safeTitle}</text>
    <text x="78" y="1322" fill="#ffffff" font-size="38" font-weight="700">${safeUserName}</text>
    <text x="78" y="1374" fill="rgba(255,255,255,0.74)" font-size="31" font-weight="500">${safeCarName}</text>
    <text x="78" y="1836" fill="#ffffff" font-size="34" font-weight="800">DrivenStat</text>
    ${statsMarkup}
  </g>
  ${routePath ? `
  <path d="${routePath}" fill="none" stroke="rgba(255,255,255,0.88)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" filter="url(#routeGlow)"/>
  ${speedSegments}
  <path d="${routePath}" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  ` : `
  <text x="540" y="540" text-anchor="middle" fill="#ffffff" font-size="42" font-weight="700" font-family="Inter, ui-sans-serif, system-ui">Route hidden by privacy zone</text>
  `}
</svg>`;

  return new File([new Blob([svg], { type: "image/svg+xml" })], `${sanitizeFileName(title)}-route-transparent.svg`, {
    type: "image/svg+xml",
  });
};

const lonToTileX = (lon: number, zoom: number) => ((lon + 180) / 360) * 2 ** zoom;
const latToTileY = (lat: number, zoom: number) => {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom;
};

const loadTile = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

const getRouteTileViewport = (points: GPXPoint[], routeBounds: Rect) => {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const usableWidth = routeBounds.width - 140;
  const usableHeight = routeBounds.height - 140;
  let zoom = 3;

  for (let z = 3; z <= 16; z++) {
    const xSpan = Math.abs(lonToTileX(maxLon, z) - lonToTileX(minLon, z)) * TILE_SIZE;
    const ySpan = Math.abs(latToTileY(minLat, z) - latToTileY(maxLat, z)) * TILE_SIZE;
    if (xSpan <= usableWidth && ySpan <= usableHeight) zoom = z;
    else break;
  }

  const centerX = ((lonToTileX(minLon, zoom) + lonToTileX(maxLon, zoom)) / 2) * TILE_SIZE;
  const centerY = ((latToTileY(minLat, zoom) + latToTileY(maxLat, zoom)) / 2) * TILE_SIZE;
  return { zoom, centerX, centerY };
};

const projectMapPointInBounds = (
  point: GPXPoint,
  viewport: { zoom: number; centerX: number; centerY: number },
  routeBounds: Rect,
) => ({
  x: lonToTileX(point.lon, viewport.zoom) * TILE_SIZE - viewport.centerX + routeBounds.x + routeBounds.width / 2,
  y: latToTileY(point.lat, viewport.zoom) * TILE_SIZE - viewport.centerY + routeBounds.y + routeBounds.height / 2,
});

const drawMapTiles = async (
  ctx: CanvasRenderingContext2D,
  viewport: { zoom: number; centerX: number; centerY: number },
  theme: "light" | "dark",
  coverBounds: Rect = { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  mapCenter = { x: WIDTH / 2, y: HEIGHT / 2 },
) => {
  const style = theme === "dark" ? "dark_all" : "rastertiles/voyager";
  const subdomains = ["a", "b", "c", "d"];
  const startTileX = Math.floor((viewport.centerX + (coverBounds.x - mapCenter.x)) / TILE_SIZE);
  const endTileX = Math.ceil((viewport.centerX + (coverBounds.x + coverBounds.width - mapCenter.x)) / TILE_SIZE);
  const startTileY = Math.floor((viewport.centerY + (coverBounds.y - mapCenter.y)) / TILE_SIZE);
  const endTileY = Math.ceil((viewport.centerY + (coverBounds.y + coverBounds.height - mapCenter.y)) / TILE_SIZE);
  const maxTile = 2 ** viewport.zoom;

  ctx.fillStyle = theme === "dark" ? "#171b22" : "#e7ece8";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const tilePromises: Promise<void>[] = [];
  for (let x = startTileX; x <= endTileX; x++) {
    for (let y = startTileY; y <= endTileY; y++) {
      if (y < 0 || y >= maxTile) continue;
      const wrappedX = ((x % maxTile) + maxTile) % maxTile;
      const subdomain = subdomains[Math.abs(x + y) % subdomains.length];
      const url = theme === "dark"
        ? `https://${subdomain}.basemaps.cartocdn.com/${style}/${viewport.zoom}/${wrappedX}/${y}.png`
        : `https://${subdomain}.basemaps.cartocdn.com/${style}/${viewport.zoom}/${wrappedX}/${y}.png`;
      const dx = x * TILE_SIZE - viewport.centerX + mapCenter.x;
      const dy = y * TILE_SIZE - viewport.centerY + mapCenter.y;
      tilePromises.push(loadTile(url).then((tile) => {
        if (tile) ctx.drawImage(tile, dx, dy, TILE_SIZE, TILE_SIZE);
      }));
    }
  }

  await Promise.all(tilePromises);
};

export const createMapShareImage = async ({
  title,
  points,
  stats,
  hideRadius,
  userName,
  carName,
  theme = "dark",
}: ShareImageOptions): Promise<File> => {
  const visiblePoints = getPrivacyClippedPoints(points, hideRadius);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create image renderer.");

  if (visiblePoints.length >= 2) {
    const viewport = getRouteTileViewport(visiblePoints, ROUTE_SQUARE);
    await drawMapTiles(ctx, viewport, theme, { x: 0, y: 0, width: WIDTH, height: HEIGHT }, {
      x: TOP_SQUARE.x + TOP_SQUARE.width / 2,
      y: TOP_SQUARE.y + TOP_SQUARE.height / 2,
    });
    drawSpeedCodedRoute(ctx, visiblePoints, visiblePoints.map((point) => projectMapPointInBounds(point, viewport, ROUTE_SQUARE)));
  } else {
    ctx.fillStyle = theme === "dark" ? "#171b22" : "#e7ece8";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  const topFade = ctx.createLinearGradient(0, 700, 0, TOP_SQUARE.height);
  topFade.addColorStop(0, "rgba(0,0,0,0)");
  topFade.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 700, WIDTH, 380);

  const overlay = ctx.createLinearGradient(0, TOP_SQUARE.height, 0, HEIGHT);
  overlay.addColorStop(0, "rgba(0,0,0,0.80)");
  overlay.addColorStop(1, "rgba(0,0,0,0.94)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, TOP_SQUARE.height, WIDTH, HEIGHT - TOP_SQUARE.height);

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 16;
  ctx.font = "800 60px Inter, ui-sans-serif, system-ui";
  drawWrappedText(ctx, title, 76, 1210, 920, 66, 2);
  ctx.font = "700 34px Inter, ui-sans-serif, system-ui";
  ctx.fillText(getDisplayName(userName), 76, 1352);
  ctx.font = "800 34px Inter, ui-sans-serif, system-ui";
  ctx.fillText("DrivenStat", 76, 1844);
  ctx.font = "500 30px Inter, ui-sans-serif, system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.76)";
  ctx.fillText(getCarName(carName), 76, 1396);

  const statCards = formatShareStats(stats);
  statCards.forEach((stat, index) => {
    const x = 76 + index * 330;
    ctx.fillStyle = "rgba(255,255,255,0.74)";
    ctx.font = "500 30px Inter, ui-sans-serif, system-ui";
    ctx.fillText(stat.label, x, 1562);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 48px Inter, ui-sans-serif, system-ui";
    drawWrappedText(ctx, stat.value, x, 1630, 270, 54, 2);
  });
  ctx.shadowBlur = 0;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Unable to export map image."));
    }, "image/png");
  });

  return new File([blob], `${sanitizeFileName(title)}-map-${theme}.png`, { type: "image/png" });
};

export const createActivityShareImage = async ({ title, points, stats, hideRadius }: ShareImageOptions): Promise<File> => {
  const visiblePoints = getPrivacyClippedPoints(points, hideRadius);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create image renderer.");

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, "#10141f");
  bg.addColorStop(0.45, "#172032");
  bg.addColorStop(1, "#090b10");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let x = -HEIGHT; x < WIDTH; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + HEIGHT, HEIGHT);
    ctx.stroke();
  }
  ctx.restore();

  const mapBounds = { x: 90, y: 280, width: 900, height: 820 };
  const mapGlow = ctx.createRadialGradient(WIDTH / 2, 710, 120, WIDTH / 2, 710, 560);
  mapGlow.addColorStop(0, "rgba(255, 122, 61, 0.24)");
  mapGlow.addColorStop(1, "rgba(255, 122, 61, 0)");
  ctx.fillStyle = mapGlow;
  ctx.fillRect(0, 180, WIDTH, 1020);

  roundRect(ctx, 58, 182, 964, 1052, 34);
  ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 58px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedText(ctx, title, 92, 116, 890, 66, 2);

  if (visiblePoints.length >= 2) {
    drawSpeedCodedRoute(ctx, visiblePoints, projectRoute(visiblePoints, mapBounds));
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "600 42px Inter, ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Route hidden by privacy zone", WIDTH / 2, 710);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.68)";
  ctx.font = "600 28px Inter, ui-sans-serif, system-ui";
  ctx.fillText(hideRadius && hideRadius > 0 ? "Privacy zones applied" : "Route map", 92, 1170);

  const statCards = [
    { label: "Distance", value: formatDistance(stats.totalDistance), accent: "#ffd166" },
    { label: "Moving time", value: formatDurationShort(stats.movingTime), accent: "#34d399" },
    { label: "Avg speed", value: formatSpeed(stats.movingAvgSpeed), accent: "#60a5fa" },
  ];

  statCards.forEach((stat, index) => {
    const x = 72;
    const y = 1308 + index * 158;
    roundRect(ctx, x, y, 936, 122, 22);
    ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.stroke();

    ctx.fillStyle = stat.accent;
    ctx.beginPath();
    ctx.arc(x + 44, y + 61, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "700 24px Inter, ui-sans-serif, system-ui";
    ctx.fillText(stat.label.toUpperCase(), x + 76, y + 48);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 44px Inter, ui-sans-serif, system-ui";
    ctx.fillText(stat.value, x + 76, y + 94);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "600 24px Inter, ui-sans-serif, system-ui";
  ctx.fillText("DrivenStat", 72, 1842);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Unable to export share image."));
    }, "image/png");
  });

  return new File([blob], `${sanitizeFileName(title)}-share.png`, { type: "image/png" });
};

export const shareOrDownloadImage = async (file: File, title: string) => {
  const shareData = { title, files: [file] };
  if (navigator.canShare?.(shareData)) {
    await navigator.share(shareData);
    return;
  }

  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadImageFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
