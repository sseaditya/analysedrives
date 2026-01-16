import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "@/components/ThemeProvider";

interface ActivityMiniMapProps {
    coordinates: [number, number][]; // [lat, lon]
    className?: string;
}

const ActivityMiniMap = ({ coordinates, className }: ActivityMiniMapProps) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const tileLayerRef = useRef<L.TileLayer | null>(null);
    const { theme } = useTheme();

    useEffect(() => {
        if (!mapContainerRef.current || !coordinates || coordinates.length === 0) return;

        // Initialize map if not already done
        if (!mapInstanceRef.current) {
            mapInstanceRef.current = L.map(mapContainerRef.current, {
                zoomControl: false,
                attributionControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                touchZoom: false,
                zoomAnimation: false,
            });
        }

        const map = mapInstanceRef.current;

        // Update tile layer based on theme
        const tileUrl = theme === 'dark'
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

        // Remove old tile layer if exists
        if (tileLayerRef.current) {
            map.removeLayer(tileLayerRef.current);
        }

        // Add new tile layer
        tileLayerRef.current = L.tileLayer(tileUrl, {
            maxZoom: 19
        }).addTo(map);

        // Clear existing polylines
        map.eachLayer((layer) => {
            if (layer instanceof L.Polyline) {
                map.removeLayer(layer);
            }
        });

        // Draw Polyline
        const polyline = L.polyline(coordinates, {
            color: 'hsl(37, 92%, 50%)', // Original Orange like main map
            weight: 3,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(map);

        // Fit bounds with padding
        const bounds = polyline.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }

        // Cleanup function
        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
                tileLayerRef.current = null;
            }
        };
    }, [coordinates, theme]);

    if (!coordinates || coordinates.length === 0) {
        return (
            <div className={`w-full h-full bg-muted/20 flex items-center justify-center ${className}`}>
                <span className="text-xs text-muted-foreground">No Preview</span>
            </div>
        );
    }

    return (
        <div className={`w-full h-full relative z-0 ${className}`}>
            <div ref={mapContainerRef} className="w-full h-full" />
            {/* Overlay to prevent interactions ensuring click goes to card */}
            <div className="absolute inset-0 z-10 bg-transparent cursor-pointer" />
        </div>
    );
};

export default ActivityMiniMap;

