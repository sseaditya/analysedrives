import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart3, Map as MapIcon, RefreshCcw, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import SpeedDistributionChart from "@/components/SpeedDistributionChart";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import React from "react";
import { SpeedBucket, parseGPX, calculateStats, generatePreviewPolyline } from "@/utils/gpxParser";
import { toast } from "sonner";

const Analytics = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loading, setLoading] = useState(true);
    const [activities, setActivities] = useState<any[]>([]);

    const [isRepairing, setIsRepairing] = useState(false);
    const [repairProgress, setRepairProgress] = useState(0);

    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const layerGroupRef = useRef<L.LayerGroup | null>(null);

    useEffect(() => {
        fetchActivities();
    }, [user]);

    const fetchActivities = async () => {
        if (!user) return;
        try {
            const { data, error } = await supabase
                .from('activities')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setActivities(data || []);
        } catch (err) {
            console.error("Error fetching activities:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleRepairData = async () => {
        if (!user || isRepairing) return;

        // Count how many need repair (missing speedDistribution)
        // actually, force update all to fix maxSpeed too?
        // User requested "ensure max speed is actual max speed".
        // Let's re-process ALL activities to be safe. 
        // But maybe warn user if many?
        // For now, just do it.

        setIsRepairing(true);
        setRepairProgress(0);
        let successCount = 0;
        let failCount = 0;

        try {
            const total = activities.length;
            for (let i = 0; i < total; i++) {
                const activity = activities[i];
                setRepairProgress(Math.round(((i + 1) / total) * 100));

                try {
                    // 1. Download file
                    const { data: fileData, error: storageError } = await supabase.storage
                        .from('gpx-files')
                        .download(activity.file_path);

                    if (storageError) throw storageError;

                    // 2. Parse & Recalculate
                    const text = await fileData.text();
                    const points = parseGPX(text);
                    const newStats = calculateStats(points);

                    // Generate Preview Polyline (Critical for Map Previews & Heatmap)
                    const previewCoordinates = generatePreviewPolyline(points);

                    const finalStats = {
                        ...newStats,
                        previewCoordinates
                    };

                    // 3. Update DB
                    const { error: updateError } = await supabase
                        .from('activities')
                        .update({ stats: finalStats })
                        .eq('id', activity.id);

                    if (updateError) throw updateError;
                    successCount++;
                } catch (err) {
                    console.error(`Failed to repair activity ${activity.id}:`, err);
                    failCount++;
                }
            }

            toast.success(`Data repair complete. Updated ${successCount} activities.`);
            if (failCount > 0) {
                toast.error(`Failed to update ${failCount} activities.`);
            }
            // Refresh data
            fetchActivities();

        } catch (error) {
            toast.error("An error occurred during data repair.");
            console.error(error);
        } finally {
            setIsRepairing(false);
        }
    };

    // 1. Global Speed Profile Aggregation
    const aggregatedSpeedDistribution = useMemo(() => {
        const bucketMap = new Map<number, { minSpeed: number, time: number, distance: number }>();

        activities.forEach(activity => {
            const dist: SpeedBucket[] = activity.stats?.speedDistribution;
            if (Array.isArray(dist)) {
                dist.forEach((bucket) => {
                    const existing = bucketMap.get(bucket.minSpeed) || { minSpeed: bucket.minSpeed, time: 0, distance: 0 };
                    existing.time += bucket.time;
                    existing.distance += bucket.distance;
                    bucketMap.set(bucket.minSpeed, existing);
                });
            }
        });

        return Array.from(bucketMap.values())
            .sort((a, b) => a.minSpeed - b.minSpeed)
            .map(b => ({
                ...b,
                range: `${b.minSpeed}-${b.minSpeed + 10}`
            }));
    }, [activities]);

    // 2. Heatmap Preparation (Extract all Polylines)
    const allTracks = useMemo(() => {
        return activities
            .filter(a => a.stats?.previewCoordinates && a.stats.previewCoordinates.length > 0)
            .map(a => ({
                id: a.id,
                coordinates: a.stats.previewCoordinates,
                title: a.title
            }));
    }, [activities]);

    const [theme, setTheme] = useState<'dark' | 'light'>('dark');

    useEffect(() => {
        // Detect theme from class or local storage to set initial map tile
        if (document.documentElement.classList.contains('dark')) {
            setTheme('dark');
        } else {
            setTheme('light');
        }

        // Observer for theme changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class') {
                    if (document.documentElement.classList.contains('dark')) {
                        setTheme('dark');
                    } else {
                        setTheme('light');
                    }
                }
            });
        });
        observer.observe(document.documentElement, { attributes: true });
        return () => observer.disconnect();
    }, []);

    // Initialize Map
    useEffect(() => {
        if (!mapRef.current || mapInstanceRef.current) return;

        const map = L.map(mapRef.current).setView([0, 0], 2);

        mapInstanceRef.current = map;
        const layerGroup = L.layerGroup().addTo(map);
        layerGroupRef.current = layerGroup;

        return () => {
            map.remove();
            mapInstanceRef.current = null;
        };
    }, []);

    // Update Tiles when Theme Changes
    useEffect(() => {
        if (!mapInstanceRef.current) return;
        const map = mapInstanceRef.current;

        // Remove existing tile layers
        map.eachLayer((layer) => {
            if (layer instanceof L.TileLayer) {
                map.removeLayer(layer);
            }
        });

        const tileUrl = theme === 'dark'
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

        L.tileLayer(tileUrl, {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        }).addTo(map);

    }, [theme]);

    // Update Map Layers
    useEffect(() => {
        const map = mapInstanceRef.current;
        const layerGroup = layerGroupRef.current;
        if (!map || !layerGroup) return;

        layerGroup.clearLayers();

        if (allTracks.length > 0) {
            const bounds = L.latLngBounds([]);

            allTracks.forEach(track => {
                if (track.coordinates.length > 0) {
                    const polyline = L.polyline(track.coordinates, {
                        color: '#eb4034', // Red-ish/Orange
                        weight: 2,
                        opacity: 0.2 // 20% opacity for heatmap effect
                    }).bindTooltip(track.title, { sticky: true });

                    polyline.addTo(layerGroup);
                    bounds.extend(polyline.getBounds());
                }
            });

            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    }, [allTracks]);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Header */}
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <BarChart3 className="w-6 h-6 text-primary" />
                        Analytics & Heatmap
                    </h1>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRepairData}
                        disabled={isRepairing}
                        className="ml-auto gap-2"
                    >
                        {isRepairing ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Repairing {repairProgress}%
                            </>
                        ) : (
                            <>
                                <RefreshCcw className="w-4 h-4" />
                                Scan & Repair Data
                            </>
                        )}
                    </Button>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 flex-1 space-y-8">

                {/* Global Speed Profile Section */}
                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-muted-foreground" />
                        Global Speed Profile
                    </h3>
                    <div className="h-[300px] w-full">
                        {aggregatedSpeedDistribution.length > 0 ? (
                            <SpeedDistributionChart buckets={aggregatedSpeedDistribution} />
                        ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                No speed data available across your activities.
                            </div>
                        )}
                    </div>
                </div>

                {/* Heatmap Section */}
                <div className="bg-card border border-border rounded-2xl p-6 h-[600px] flex flex-col">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <MapIcon className="w-5 h-5 text-muted-foreground" />
                        Global Activity Heatmap
                    </h3>
                    <div className="flex-1 rounded-xl overflow-hidden border border-border relative z-0">
                        <div ref={mapRef} className="h-full w-full bg-muted/10" />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Analytics;
