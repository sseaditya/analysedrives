import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "@/components/ThemeProvider";
import type { ComparisonPoint, ComparisonSeries, Segment } from "@/types/segments";

function themeColor(property: string) {
  return `hsl(${getComputedStyle(document.documentElement).getPropertyValue(property).trim()})`;
}

function positionAtElapsed(points: ComparisonPoint[], elapsed: number, side: "A" | "B"): L.LatLngExpression {
  const elapsedKey = side === "A" ? "elapsedA" : "elapsedB";
  const pointKey = side === "A" ? "pointA" : "pointB";
  if (elapsed <= 0) return [points[0][pointKey].lat, points[0][pointKey].lon];
  const last = points[points.length - 1];
  if (elapsed >= last[elapsedKey]) return [last[pointKey].lat, last[pointKey].lon];
  let right = points.findIndex((point) => point[elapsedKey] >= elapsed);
  if (right <= 0) right = 1;
  const left = right - 1;
  const startTime = points[left][elapsedKey];
  const endTime = points[right][elapsedKey];
  const ratio = endTime > startTime ? (elapsed - startTime) / (endTime - startTime) : 0;
  const start = points[left][pointKey];
  const end = points[right][pointKey];
  return [start.lat + (end.lat - start.lat) * ratio, start.lon + (end.lon - start.lon) * ratio];
}

export default function ComparisonMap({ segment, series, cursorSeconds }: { segment: Segment; series: ComparisonSeries; cursorSeconds: number }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerARef = useRef<L.CircleMarker | null>(null);
  const markerBRef = useRef<L.CircleMarker | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    // The comparison only renders three short paths and two markers. Leaflet's
    // canvas renderer keeps those layers in a linked draw list, which can be
    // left in an invalid state when React tears down and recreates this effect.
    // SVG is inexpensive here and removes that renderer lifecycle race.
    mapRef.current = L.map(elementRef.current, { preferCanvas: false, scrollWheelZoom: true });
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(theme === "dark" ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !series.points.length) return;
    const group = L.layerGroup().addTo(map);
    const reference = segment.geometry.slice(series.startSegmentIndex, series.endSegmentIndex + 1).map((point) => [point.lat, point.lon] as [number, number]);
    const routeA = series.points.map((point) => [point.pointA.lat, point.pointA.lon] as [number, number]);
    const routeB = series.points.map((point) => [point.pointB.lat, point.pointB.lon] as [number, number]);
    const driveAColor = themeColor("--segment-drive-1");
    const driveBColor = themeColor("--segment-drive-2");
    const referenceColor = themeColor("--foreground");
    const markerOutline = themeColor("--card");
    L.polyline(reference, { color: referenceColor, weight: 8, opacity: 0.22, dashArray: "6 8" }).addTo(group);
    L.polyline(routeA, { color: driveAColor, weight: 5, opacity: 0.8 }).addTo(group);
    L.polyline(routeB, { color: driveBColor, weight: 5, opacity: 0.75 }).addTo(group);
    const driveMarkerRadius = 8;
    markerARef.current = L.circleMarker(routeA[0], { radius: driveMarkerRadius, color: markerOutline, weight: 2, fillColor: driveAColor, fillOpacity: 1 }).bindTooltip("Drive 1", { permanent: false }).addTo(group);
    markerBRef.current = L.circleMarker(routeB[0], { radius: driveMarkerRadius, color: markerOutline, weight: 2, fillColor: driveBColor, fillOpacity: 1 }).bindTooltip("Drive 2", { permanent: false }).addTo(group);
    map.fitBounds(L.latLngBounds([...routeA, ...routeB]), { padding: [40, 40], maxZoom: 16 });
    return () => { group.remove(); markerARef.current = null; markerBRef.current = null; };
  }, [segment, series, theme]);

  useEffect(() => {
    if (!series.points.length) return;
    markerARef.current?.setLatLng(positionAtElapsed(series.points, cursorSeconds, "A"));
    markerBRef.current?.setLatLng(positionAtElapsed(series.points, cursorSeconds, "B"));
  }, [cursorSeconds, series]);

  return <div className="relative overflow-hidden rounded-xl border"><div ref={elementRef} className="h-[420px] w-full" /><div className="absolute bottom-4 left-1/2 z-[400] flex -translate-x-1/2 gap-3 rounded-full border bg-card/90 px-4 py-2 text-xs shadow-lg backdrop-blur"><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--segment-drive-1))]" />Drive 1</span><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--segment-drive-2))]" />Drive 2</span></div></div>;
}
