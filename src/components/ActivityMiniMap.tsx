import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface ActivityMiniMapProps {
    coordinates: [number, number][]; // [lat, lon]
    className?: string;
}

const ActivityMiniMap = ({ coordinates, className }: ActivityMiniMapProps) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);

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

            // Use Dark Matter tile layer to match main map
            L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
                maxZoom: 19
            }).addTo(mapInstanceRef.current);
        }

        const map = mapInstanceRef.current;

        // Clear existing layers (if coordinates change)
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
            }
        };
    }, [coordinates]);

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
