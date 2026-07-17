import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "@/components/ThemeProvider";
import { haversineDistance } from "@/utils/gpxParser";
import { getSpeedRouteColor } from "@/utils/mapColors";

interface ActivityMiniMapProps {
    coordinates: [number, number][]; // [lat, lon]
    speeds?: number[]; // speed for each line between consecutive coordinates
    averageSpeed?: number;
    className?: string;
}

class SpeedRouteCanvasLayer extends L.Layer {
    private map?: L.Map;
    private canvas?: HTMLCanvasElement;

    constructor(
        private coordinates: [number, number][],
        private speeds: number[]
    ) {
        super();
    }

    onAdd(map: L.Map) {
        this.map = map;
        this.canvas = L.DomUtil.create('canvas', 'leaflet-speed-route-layer') as HTMLCanvasElement;
        this.canvas.style.pointerEvents = 'none';
        map.getPanes().overlayPane.appendChild(this.canvas);
        map.on('moveend zoomend resize', this.redraw);
        this.redraw();
        return this;
    }

    onRemove(map: L.Map) {
        map.off('moveend zoomend resize', this.redraw);
        this.canvas?.remove();
        this.canvas = undefined;
        this.map = undefined;
        return this;
    }

    private redraw = () => {
        if (!this.map || !this.canvas) return;

        const size = this.map.getSize();
        const pixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = size.x * pixelRatio;
        this.canvas.height = size.y * pixelRatio;
        this.canvas.style.width = `${size.x}px`;
        this.canvas.style.height = `${size.y}px`;
        L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));

        const context = this.canvas.getContext('2d');
        if (!context) return;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.lineCap = 'round';
        context.lineJoin = 'round';

        context.beginPath();
        this.coordinates.forEach((coordinate, index) => {
            const point = this.map!.latLngToContainerPoint(coordinate);
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
        });
        context.strokeStyle = 'hsl(215, 35%, 72%)';
        context.globalAlpha = 0.35;
        context.lineWidth = 3;
        context.stroke();

        context.globalAlpha = 1;
        context.lineWidth = 4;
        this.speeds.forEach((speed, index) => {
            const start = this.coordinates[index];
            const end = this.coordinates[index + 1];
            if (!start || !end) return;

            const startPoint = this.map!.latLngToContainerPoint(start);
            const endPoint = this.map!.latLngToContainerPoint(end);
            context.beginPath();
            context.moveTo(startPoint.x, startPoint.y);
            context.lineTo(endPoint.x, endPoint.y);
            context.strokeStyle = getSpeedRouteColor(speed);
            context.stroke();
        });
    };
}

function estimatePreviewSpeeds(coordinates: [number, number][], averageSpeed?: number): number[] {
    if (!averageSpeed || averageSpeed <= 0 || coordinates.length < 2) return [];

    const distances = coordinates.slice(1).map((coordinate, index) => (
        haversineDistance(
            coordinates[index][0],
            coordinates[index][1],
            coordinate[0],
            coordinate[1]
        )
    ));
    const meanDistance = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;

    if (meanDistance <= 0) return distances.map(() => averageSpeed);
    return distances.map(distance => (distance / meanDistance) * averageSpeed);
}

const ActivityMiniMap = ({ coordinates, speeds, averageSpeed, className }: ActivityMiniMapProps) => {
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
                preferCanvas: true,
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

        const routeSpeeds = speeds?.length === coordinates.length - 1
            ? speeds
            : estimatePreviewSpeeds(coordinates, averageSpeed);

        if (routeSpeeds.length > 0) {
            new SpeedRouteCanvasLayer(coordinates, routeSpeeds).addTo(map);
        } else {
            L.polyline(coordinates, {
                color: 'hsl(37, 92%, 50%)',
                weight: 4,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false
            }).addTo(map);
        }

        // Fit bounds with padding
        const bounds = L.latLngBounds(coordinates);
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
    }, [coordinates, speeds, averageSpeed, theme]);

    if (!coordinates || coordinates.length === 0) {
        return (
            <div className={`w-full h-full bg-muted/20 flex items-center justify-center ${className}`}>
                <span className="text-xs text-muted-foreground">No Preview</span>
            </div>
        );
    }

    return (
        <div className="relative h-full w-full bg-muted/20 overflow-hidden isolation-isolate z-0">
            {/* Map Container */}
            <div id="mini-map" ref={mapContainerRef} className="absolute inset-0 z-0 bg-background" />
            {/* Overlay to prevent interactions ensuring click goes to card */}
            <div className="absolute inset-0 z-10 bg-transparent cursor-pointer" />
        </div>
    );
};

export default ActivityMiniMap;
