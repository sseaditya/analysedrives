import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { GPXPoint, analyzeSegments, TrackSegment } from "@/utils/gpxParser";
import { Layers, Activity, Zap, Maximize2, Map } from "lucide-react";

interface TrackMapProps {
  points: GPXPoint[];
  hoveredPoint?: GPXPoint | null;
  zoomRange?: [number, number] | null;
  stopPoints?: [number, number][];
  tightTurnPoints?: [number, number][];
  privacyMask?: { start: number; end: number } | null;
}

const TrackMap = ({ points, hoveredPoint, zoomRange, stopPoints, tightTurnPoints, privacyMask }: TrackMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    fullTrackGroup?: L.LayerGroup;
    zoomedTrack?: L.Polyline;
    startMarker?: L.Marker;
    endMarker?: L.Marker;
    stopMarkers?: L.LayerGroup;
    turnMarkers?: L.LayerGroup;
  }>({});
  const hoverMarkerRef = useRef<L.Marker | null>(null);
  const lastBoundsRef = useRef<{ points: GPXPoint[], zoomRange?: [number, number] | null } | null>(null);

  const [mode, setMode] = useState<'plain' | 'speed' | 'acceleration'>('plain');
  const [showStops, setShowStops] = useState(false);
  const [showTurns, setShowTurns] = useState(false);

  // Pre-calculate segments for performance
  const segments = useMemo(() => {
    // We always calculate segments now to support the loop-based selection rendering
    return analyzeSegments(points);
  }, [points]);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoom: 13,
      scrollWheelZoom: false,
      touchZoom: true,
      doubleClickZoom: true,
      preferCanvas: true, // Improve performance with many points
    });

    mapInstanceRef.current = map;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Tracks and Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || points.length === 0) return;

    // Clear existing layers
    if (layersRef.current.fullTrackGroup) layersRef.current.fullTrackGroup.clearLayers();
    if (layersRef.current.zoomedTrack) map.removeLayer(layersRef.current.zoomedTrack);
    if (layersRef.current.startMarker) map.removeLayer(layersRef.current.startMarker);
    if (layersRef.current.endMarker) map.removeLayer(layersRef.current.endMarker);
    if (layersRef.current.stopMarkers) map.removeLayer(layersRef.current.stopMarkers);
    if (layersRef.current.turnMarkers) map.removeLayer(layersRef.current.turnMarkers);

    // Create a LayerGroup for the track to manage cleanup easily
    if (!layersRef.current.fullTrackGroup) {
      layersRef.current.fullTrackGroup = L.layerGroup().addTo(map);
    }
    const trackGroup = layersRef.current.fullTrackGroup;

    const allCoordinates: [number, number][] = points.map((p) => [p.lat, p.lon]);

    // Determine which points to focus on
    let focusCoordinates = allCoordinates;
    let zoomedCoordinates: [number, number][] | null = null;

    if (zoomRange) {
      zoomedCoordinates = points
        .slice(zoomRange[0], zoomRange[1] + 1)
        .map(p => [p.lat, p.lon]);
      focusCoordinates = zoomedCoordinates;
    }

    // 0. Base Continuous Line (Visual Foundation)
    let currentBaseColor = "hsl(24, 80%, 70%)"; // Default Light Orange
    let currentBaseOpacity = 0.4;
    let currentBaseWeight = 4;

    if (mode === 'plain' && !zoomRange) {
      currentBaseColor = "hsl(37, 92%, 50%)"; // Original Dark Orange
      currentBaseOpacity = 0.8;
      currentBaseWeight = 5;
    } else if (mode !== 'plain') {
      currentBaseOpacity = 0.3;
    }

    if (privacyMask) {
      // 1. Hidden Start (Translucent & Dashed)
      if (privacyMask.start > 0) {
        L.polyline(allCoordinates.slice(0, privacyMask.start + 1), {
          color: currentBaseColor,
          weight: currentBaseWeight,
          opacity: 0.3,
          dashArray: '10, 10',
          interactive: false,
          lineJoin: 'round'
        }).addTo(trackGroup);
      }

      // 2. Visible Middle (Normal)
      L.polyline(allCoordinates.slice(privacyMask.start, privacyMask.end + 1), {
        color: currentBaseColor,
        weight: currentBaseWeight,
        opacity: currentBaseOpacity,
        interactive: false,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(trackGroup);

      // 3. Hidden End (Translucent & Dashed)
      if (privacyMask.end < allCoordinates.length - 1) {
        L.polyline(allCoordinates.slice(privacyMask.end), {
          color: currentBaseColor,
          weight: currentBaseWeight,
          opacity: 0.3,
          dashArray: '10, 10',
          interactive: false,
          lineJoin: 'round'
        }).addTo(trackGroup);
      }
    } else {
      // Standard Full Track
      L.polyline(allCoordinates, {
        color: currentBaseColor,
        weight: currentBaseWeight,
        opacity: currentBaseOpacity,
        interactive: false,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(trackGroup);
    }

    // 1. Render Segment Overlays
    const shouldRenderSegments = (mode !== 'plain') || (mode === 'plain' && zoomRange);

    if (shouldRenderSegments) {
      let maxSpeed = 1;
      if (mode === 'speed') {
        const speedValues = segments.map(s => s.speed);
        maxSpeed = Math.max(...speedValues, 1);
      }

      segments.forEach((seg, i) => {
        const p1 = points[i];
        const p2 = points[i + 1];
        if (!p1 || !p2) return;

        // Privacy Filter for Analysis Layers
        if (privacyMask) {
          if (i < privacyMask.start || i >= privacyMask.end) return;
        }

        // In analytics mode without zoom, highlight everything. 
        // In plain mode with zoom, ONLY highlight the selection.
        const isHighlighted = zoomRange ? (i >= zoomRange[0] && i < zoomRange[1]) : (mode !== 'plain');

        if (!isHighlighted) return;

        let color = 'white';
        let weight = 6;
        let opacity = 1.0;

        if (mode === 'plain') {
          color = "hsl(24, 100%, 35%)"; // Rich Dark Orange
          weight = 6; // Thicker for better highlight visibility
        } else if (mode === 'speed') {
          const ratio = Math.min(seg.speed / maxSpeed, 1);
          const lightness = 90 - (ratio * 65);
          color = `hsl(215, 95%, ${lightness}%)`;
        } else if (mode === 'acceleration') {
          const val = seg.acceleration;
          if (val > 0.1) {
            const ratio = Math.min(val / 2.0, 1);
            const lightness = 85 - (ratio * 45);
            color = `hsl(142, 85%, ${lightness}%)`;
          } else if (val < -0.1) {
            const ratio = Math.min(Math.abs(val) / 2.0, 1);
            const lightness = 85 - (ratio * 45);
            color = `hsl(0, 90%, ${lightness}%)`;
          } else {
            color = 'transparent';
          }
        }

        if (color !== 'transparent') {
          L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
            color,
            weight,
            opacity,
            interactive: false,
            lineJoin: 'round',
            lineCap: 'round'
          }).addTo(trackGroup);
        }
      });
    }

    // 2. Zoomed Track Cleanup: 
    // We've integrated the zoomed track into the loop (isHighlighted) for consistency.
    // The previous standalone zoomedTrack polyline is no longer needed as an overlay.
    // However, we fit bounds to the focus coordinates as before.


    // Zoomed track is now handled within the segment loop for better dynamics.


    // Add Markers
    // Start Icon
    const startIcon = L.divIcon({
      className: "custom-marker",
      html: `<div style="background-color: hsl(142, 76%, 36%); width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
      </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const endIcon = L.divIcon({
      className: "custom-marker",
      html: `<div style="background-color: hsl(0, 72%, 50%); width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16"/></svg>
      </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    if (focusCoordinates.length > 0) {
      if (allCoordinates.length > 0) {
        layersRef.current.startMarker = L.marker(allCoordinates[0], { icon: startIcon })
          .bindPopup("Start")
          .addTo(map);
      }
      if (allCoordinates.length > 1) {
        layersRef.current.endMarker = L.marker(allCoordinates[allCoordinates.length - 1], { icon: endIcon })
          .bindPopup("End")
          .addTo(map);
      }
    }

    // 3. Render Stop Markers
    if (showStops && stopPoints && stopPoints.length > 0) {
      const stopMarkersLayer = L.layerGroup();
      stopPoints.forEach((stop, index) => {
        // Red dot icon
        const stopIcon = L.divIcon({
          className: "stop-marker",
          html: `<div style="background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        L.marker(stop, { icon: stopIcon })
          .bindPopup(`<b>Full Stop #${index + 1}</b>`)
          .addTo(stopMarkersLayer);
      });
      stopMarkersLayer.addTo(map);
      layersRef.current.stopMarkers = stopMarkersLayer;
    }

    // 4. Render Tight Turn Markers
    if (showTurns && tightTurnPoints && tightTurnPoints.length > 0) {
      const turnMarkersLayer = L.layerGroup();
      tightTurnPoints.forEach((turn, index) => {
        const turnIcon = L.divIcon({
          className: "turn-marker",
          html: `<div style="background-color: #a855f7; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;">
            <div style="width: 4px; height: 4px; background-color: white; border-radius: 50%;"></div>
          </div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        L.marker(turn, { icon: turnIcon })
          .bindPopup(`<b>Tight Turn #${index + 1}</b>`)
          .addTo(turnMarkersLayer);
      });
      turnMarkersLayer.addTo(map);
      layersRef.current.turnMarkers = turnMarkersLayer;
    }

    // Fit Bounds - ONLY if coordinates or zoom range changed
    // Determine if we should re-fit bounds
    const shouldFitBounds = !lastBoundsRef.current ||
      lastBoundsRef.current.points !== points ||
      lastBoundsRef.current.zoomRange?.[0] !== zoomRange?.[0] ||
      lastBoundsRef.current.zoomRange?.[1] !== zoomRange?.[1];

    if (focusCoordinates.length > 0 && shouldFitBounds) {
      const bounds = L.latLngBounds(focusCoordinates);
      map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 1, maxZoom: 16 });
      lastBoundsRef.current = { points, zoomRange };
    }

  }, [points, zoomRange, stopPoints, tightTurnPoints, mode, showStops, showTurns, segments]); // Re-run when points, zoom, mode, or stops/turns change

  // Hover Effect (Separate Effect to avoid redrawing tracks)
  useEffect(() => {
    // ... (Keep existing hover logic)
    if (!mapInstanceRef.current) return;

    if (hoverMarkerRef.current) {
      mapInstanceRef.current.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }

    if (hoveredPoint) {
      const hoverIcon = L.divIcon({
        className: "custom-marker-hover",
        html: `<div style="background-color: hsl(37, 92%, 50%); width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;">
          <div style="width: 8px; height: 8px; background-color: white; border-radius: 50%;"></div>
        </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const marker = L.marker([hoveredPoint.lat, hoveredPoint.lon], {
        icon: hoverIcon,
        zIndexOffset: 1000,
      });

      if (hoveredPoint.time) {
        marker.bindPopup(hoveredPoint.time.toLocaleTimeString());
      }

      marker.addTo(mapInstanceRef.current);
      hoverMarkerRef.current = marker;
    }
  }, [hoveredPoint]);

  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-card relative shadow-2xl">
      <div ref={mapRef} className="w-full h-[600px]" />

      {/* Map Controls Overlay (Top Right) */}
      <div className="absolute top-4 right-4 z-[400] bg-card/90 backdrop-blur-md border border-border rounded-2xl p-1 shadow-2xl flex items-center gap-2">
        {/* Mode Selector */}
        <div className="flex bg-muted/40 rounded-xl p-1 gap-1">
          <button
            onClick={() => setMode('plain')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${mode === 'plain' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title="Plain Track"
          >
            <Map className="w-4 h-4" /> <span className="hidden sm:inline">Plain</span>
          </button>
          <button
            onClick={() => setMode('speed')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${mode === 'speed' ? 'bg-background shadow text-blue-500' : 'text-muted-foreground hover:text-foreground'}`}
            title="Speed Heatmap"
          >
            <Zap className="w-4 h-4" /> <span className="hidden sm:inline">Speed</span>
          </button>
          <button
            onClick={() => setMode('acceleration')}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${mode === 'acceleration' ? 'bg-background shadow text-emerald-500' : 'text-muted-foreground hover:text-foreground'}`}
            title="Acceleration Heatmap"
          >
            <Activity className="w-4 h-4" /> <span className="hidden sm:inline">Accel</span>
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-border mx-1" />

        {/* Marker Toggles */}
        <div className="flex gap-1 pr-1">
          <button
            onClick={() => setShowStops(!showStops)}
            className={`p-2 rounded-xl transition-all border flex items-center gap-2 ${showStops ? 'bg-red-500 text-white border-red-500/50 shadow-lg shadow-red-500/20' : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/60'}`}
            title={showStops ? "Hide Stops" : "Show Stops"}
          >
            <div className={`w-2 h-2 rounded-full ${showStops ? 'bg-white' : 'bg-red-500'}`} />
            <span className="text-[10px] font-black uppercase tracking-tight hidden lg:inline">Stops</span>
          </button>
          <button
            onClick={() => setShowTurns(!showTurns)}
            className={`p-2 rounded-xl transition-all border flex items-center gap-2 ${showTurns ? 'bg-purple-500 text-white border-purple-500/50 shadow-lg shadow-purple-500/20' : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/60'}`}
            title={showTurns ? "Hide Turns" : "Show Turns"}
          >
            <div className={`w-2 h-2 rounded-full ${showTurns ? 'bg-white' : 'bg-purple-500'}`} />
            <span className="text-[10px] font-black uppercase tracking-tight hidden lg:inline">Turns</span>
          </button>
        </div>
      </div>

      {/* Legend Overlay (Bottom Middle) - Ultra Compact */}
      {mode !== 'plain' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[400] bg-card/90 backdrop-blur-md border border-border rounded-full px-4 py-2 shadow-2xl animate-in fade-in slide-in-from-bottom-4 flex items-center gap-3">
          {mode === 'speed' ? (
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black uppercase tracking-tighter text-muted-foreground">Slow</span>
              <div className="h-1.5 w-[120px] rounded-full bg-gradient-to-r from-[hsl(215,95%,90%)] to-[hsl(215,95%,25%)]" />
              <span className="text-[9px] font-black uppercase tracking-tighter text-muted-foreground">Fast</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black uppercase tracking-tighter text-muted-foreground text-red-500">Braking</span>
              <div className="h-1.5 w-[120px] rounded-full bg-gradient-to-r from-red-500 via-muted-foreground/20 to-emerald-500" />
              <span className="text-[9px] font-black uppercase tracking-tighter text-muted-foreground text-emerald-500">Accel</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TrackMap;
