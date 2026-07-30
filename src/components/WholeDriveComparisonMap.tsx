import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "@/components/ThemeProvider";
import {
  markerPulseDurationSeconds,
  sampleDriveAtElapsed,
  sampleDriveMapAtElapsed,
} from "@/lib/driveComparison";
import type { DriveComparisonTrack } from "@/types/driveComparison";

function themeColor(property: string) {
  return `hsl(${getComputedStyle(document.documentElement).getPropertyValue(property).trim()})`;
}

function updatePulse(marker: L.CircleMarker | null, speed: number) {
  const element = marker?.getElement() as SVGElement | undefined;
  if (!element) return;
  const duration = markerPulseDurationSeconds(speed);
  if (duration == null) {
    element.classList.remove("speed-pulse-marker");
    element.style.removeProperty("--marker-pulse-duration");
    return;
  }
  element.classList.add("speed-pulse-marker");
  element.style.setProperty("--marker-pulse-duration", `${duration}s`);
}

export default function WholeDriveComparisonMap({
  driveA,
  driveB,
  cursorValue,
}: {
  driveA: DriveComparisonTrack;
  driveB: DriveComparisonTrack;
  cursorValue: number;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerARef = useRef<L.CircleMarker | null>(null);
  const markerBRef = useRef<L.CircleMarker | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    mapRef.current = L.map(elementRef.current, {
      preferCanvas: false,
      scrollWheelZoom: true,
    });
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(
      theme === "dark"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      { attribution: "&copy; OpenStreetMap &copy; CARTO" },
    ).addTo(map);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const group = L.layerGroup().addTo(map);
    const routeA = driveA.mapPoints.map((point) => [point.lat, point.lon] as [number, number]);
    const routeB = driveB.mapPoints.map((point) => [point.lat, point.lon] as [number, number]);
    const driveAColor = themeColor("--segment-drive-1");
    const driveBColor = themeColor("--segment-drive-2");
    const markerOutline = themeColor("--card");

    if (routeA.length > 1) L.polyline(routeA, { color: driveAColor, weight: 5, opacity: 0.82 }).addTo(group);
    if (routeB.length > 1) L.polyline(routeB, { color: driveBColor, weight: 5, opacity: 0.78 }).addTo(group);
    if (routeA[0]) {
      markerARef.current = L.circleMarker(routeA[0], {
        radius: 8,
        color: markerOutline,
        weight: 2,
        fillColor: driveAColor,
        fillOpacity: 1,
        className: "position-marker",
      }).bindTooltip(driveA.activity.title).addTo(group);
    }
    if (routeB[0]) {
      markerBRef.current = L.circleMarker(routeB[0], {
        radius: 8,
        color: markerOutline,
        weight: 2,
        fillColor: driveBColor,
        fillOpacity: 1,
        className: "position-marker",
      }).bindTooltip(driveB.activity.title).addTo(group);
    }

    const allCoordinates = [...routeA, ...routeB];
    if (allCoordinates.length) {
      map.fitBounds(L.latLngBounds(allCoordinates), { padding: [40, 40], maxZoom: 16 });
    }
    return () => {
      group.remove();
      markerARef.current = null;
      markerBRef.current = null;
    };
  }, [driveA, driveB, theme]);

  useEffect(() => {
    const updateMarker = (marker: L.CircleMarker | null, drive: DriveComparisonTrack) => {
      if (!marker) return;
      const position = sampleDriveMapAtElapsed(drive, cursorValue);
      const element = marker.getElement() as SVGElement | undefined;
      if (!position) {
        if (element) element.style.display = "none";
        return;
      }
      if (element) element.style.removeProperty("display");
      marker.setLatLng([position.lat, position.lon]);
      updatePulse(marker, sampleDriveAtElapsed(drive, cursorValue).speed);
    };
    updateMarker(markerARef.current, driveA);
    updateMarker(markerBRef.current, driveB);
  }, [cursorValue, driveA, driveB]);

  const privacyNote = driveA.privacyLimited || driveB.privacyLimited;
  return (
    <div className="relative overflow-hidden rounded-xl border">
      <div ref={elementRef} className="h-[420px] w-full" />
      <div className="absolute bottom-4 left-1/2 z-[400] flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col items-center gap-1 rounded-2xl border bg-card/90 px-4 py-2 text-xs shadow-lg backdrop-blur sm:rounded-full">
        <div className="flex max-w-full gap-3">
          <span className="flex min-w-0 items-center gap-1">
            <i className="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--segment-drive-1))]" />
            <span className="truncate">{driveA.activity.title}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <i className="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--segment-drive-2))]" />
            <span className="truncate">{driveB.activity.title}</span>
          </span>
        </div>
        {privacyNote && (
          <span className="max-w-full truncate text-[10px] text-muted-foreground">
            Public privacy zones are hidden
          </span>
        )}
      </div>
    </div>
  );
}
