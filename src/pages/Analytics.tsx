import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart3, Map as MapIcon, RefreshCcw, Loader2, TrendingUp, User, Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import HeaderProfile from "@/components/HeaderProfile";
import { ThemeToggle } from "@/components/ThemeToggle";
import SpeedDistributionChart from "@/components/SpeedDistributionChart";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import React from "react";
import { SpeedBucket, parseGPX, calculateStats, generatePreviewPolyline, formatDistance, generateProcessedTrack, haversineDistance } from "@/utils/gpxParser";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type TimePeriod = 'week' | 'month' | 'year' | 'all';

interface ActivityRecord {
    id: string;
    user_id: string;
    title: string;
    file_path: string;
    hide_radius: number | null;
    public: boolean;
    stats: {
        previewCoordinates?: [number, number][];
        speedDistribution?: SpeedBucket[];
        totalDistance?: number;
        totalTime?: number;
        maxSpeed?: number;
        startTime?: string;
    } | null;
    created_at: string;
}

const Analytics = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loading, setLoading] = useState(true);
    const [myActivities, setMyActivities] = useState<ActivityRecord[]>([]);
    const [allActivities, setAllActivities] = useState<ActivityRecord[]>([]);
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');
    const [showGlobalHeatmap, setShowGlobalHeatmap] = useState(false);

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
            // Fetch user's own activities
            const { data: myData, error: myError } = await supabase
                .from('activities')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (myError) throw myError;
            setMyActivities(myData || []);

            // Fetch ALL activities for global heatmap (same as original behavior)
            // We apply privacy clipping when displaying, not when fetching
            const { data: allData, error: allError } = await supabase
                .from('activities')
                .select('*')
                .order('created_at', { ascending: false });

            if (allError) throw allError;
            setAllActivities(allData || []);
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
            const total = myActivities.length;
            for (let i = 0; i < total; i++) {
                const activity = myActivities[i];
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

                    // Generate FULL processed track (includes stats, preview, and detailed points)
                    // This uses the new pause handling logic in gpxParser.
                    const processedTrack = generateProcessedTrack(points);

                    // 3. Upload processed.json (Overwrite existing)
                    // Construct cache filename: activity.file_path is like "uid/timestamp_name.gpx"
                    // We need to replace .gpx with .processed.json
                    const gpxPath = activity.file_path;
                    const jsonPath = gpxPath.replace(/\.gpx$/i, '') + '.processed.json';

                    const { error: uploadError } = await supabase.storage
                        .from('gpx-files')
                        .upload(jsonPath, new Blob([JSON.stringify(processedTrack)], { type: 'application/json' }), {
                            upsert: true // Overwrite if exists
                        });

                    if (uploadError) {
                        console.warn(`Failed to update JSON for ${activity.id}:`, uploadError);
                        // We continue, as DB update is more critical for listing, but this is suboptimal.
                    }

                    // 4. Update DB
                    const finalStats = {
                        ...processedTrack.stats,
                        previewCoordinates: processedTrack.previewCoordinates
                    };

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

    // Cumulative Stats with Time Period Filtering (User's own activities only)
    const cumulativeStats = useMemo(() => {
        const now = new Date();
        const periodActivities = myActivities.filter(a => {
            if (timePeriod === 'all') return true;
            const date = new Date(a.stats?.startTime || a.created_at);
            const diffTime = Math.abs(now.getTime() - date.getTime());
            const diffDays = diffTime / (1000 * 60 * 60 * 24);

            if (timePeriod === 'week') return diffDays <= 7;
            if (timePeriod === 'month') return diffDays <= 30;
            if (timePeriod === 'year') return diffDays <= 365;
            return true;
        });

        const count = periodActivities.length;
        const totalDist = periodActivities.reduce((acc, curr) => acc + (curr.stats?.totalDistance || 0), 0);
        const totalTime = periodActivities.reduce((acc, curr) => acc + (curr.stats?.totalTime || 0), 0);
        const avgSpeed = totalTime > 0 ? totalDist / (totalTime / 3600) : 0;
        const maxSpeed = Math.max(...periodActivities.map(a => a.stats?.maxSpeed || 0), 0);

        return {
            count,
            totalDist,
            totalTime,
            avgSpeed,
            maxSpeed
        };
    }, [myActivities, timePeriod]);

    // Speed Profile Aggregation (User's own activities only)
    const aggregatedSpeedDistribution = useMemo(() => {
        const bucketMap = new Map<number, { minSpeed: number, time: number, distance: number }>();

        myActivities.forEach(activity => {
            const dist: SpeedBucket[] | undefined = activity.stats?.speedDistribution;
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
    }, [myActivities]);

    // Helper function to clip track coordinates by hide_radius
    const clipTrackByRadius = (coordinates: [number, number][], hideRadius: number): [number, number][] => {
        if (!hideRadius || hideRadius <= 0 || coordinates.length < 2) {
            return coordinates;
        }

        let cumulativeDist = 0;
        let startIndex = 0;

        // Find start index (distance > hideRadius from start)
        for (let i = 1; i < coordinates.length; i++) {
            const dist = haversineDistance(
                coordinates[i - 1][0], coordinates[i - 1][1],
                coordinates[i][0], coordinates[i][1]
            );
            cumulativeDist += dist;
            if (cumulativeDist >= hideRadius) {
                startIndex = i;
                break;
            }
        }

        // Find end index (distance > hideRadius from end)
        cumulativeDist = 0;
        let endIndex = coordinates.length - 1;
        for (let i = coordinates.length - 2; i >= 0; i--) {
            const dist = haversineDistance(
                coordinates[i][0], coordinates[i][1],
                coordinates[i + 1][0], coordinates[i + 1][1]
            );
            cumulativeDist += dist;
            if (cumulativeDist >= hideRadius) {
                endIndex = i;
                break;
            }
        }

        // Safety check: if start crosses end, return empty
        if (startIndex >= endIndex) {
            return [];
        }

        return coordinates.slice(startIndex, endIndex + 1);
    };

    // Heatmap Preparation - depends on toggle
    const heatmapTracks = useMemo(() => {
        let sourceActivities: ActivityRecord[];

        if (showGlobalHeatmap) {
            // Global: Only show public drives from all users
            sourceActivities = allActivities.filter(a => a.public === true);
        } else {
            // Your: Show all your drives (public and private)
            sourceActivities = myActivities;
        }

        return sourceActivities
            .filter(a => a.stats?.previewCoordinates && a.stats.previewCoordinates.length > 0)
            .map(a => {
                let coordinates = a.stats!.previewCoordinates!;

                // For global heatmap, clip ends by hide_radius for privacy (only for other users' tracks)
                if (showGlobalHeatmap && a.user_id !== user?.id && a.hide_radius && a.hide_radius > 0) {
                    coordinates = clipTrackByRadius(coordinates, a.hide_radius);
                }

                return {
                    id: a.id,
                    coordinates,
                    title: a.title
                };
            })
            .filter(t => t.coordinates.length > 0); // Filter out empty tracks after clipping
    }, [showGlobalHeatmap, allActivities, myActivities, user?.id]);

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

        if (heatmapTracks.length > 0) {
            const bounds = L.latLngBounds([]);

            heatmapTracks.forEach(track => {
                if (track.coordinates.length > 0) {
                    const polyline = L.polyline(track.coordinates, {
                        color: '#eb4034', // Red-ish/Orange
                        weight: 2,
                        opacity: 0.2 // 20% opacity for heatmap effect
                    });

                    // Create clickable popup with link to activity
                    const popupContent = `<a href="/activity/${track.id}" style="color: inherit; text-decoration: underline; font-weight: 500;">${track.title}</a>`;
                    polyline.bindPopup(popupContent, { closeButton: false });

                    // Also keep a tooltip for quick preview on hover
                    polyline.bindTooltip(track.title, { sticky: true });

                    polyline.addTo(layerGroup);
                    bounds.extend(polyline.getBounds());
                }
            });

            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    }, [heatmapTracks, navigate]);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Header */}
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => navigate('/dashboard')}>
                            <span className="font-bold text-xl text-foreground hidden md:block">DrivenStat</span>
                        </div>
                        {user && (
                            <>
                                <div className="h-6 w-px bg-border hidden md:block" />
                                <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
                                    <ArrowLeft className="w-4 h-4" />
                                </Button>
                                <div className="h-6 w-px bg-border hidden md:block" />
                            </>
                        )}
                        <h1 className="text-lg font-bold flex items-center gap-2">
                            Analytics & Heatmap
                        </h1>
                    </div>

                    <div className="flex items-center gap-4">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRepairData}
                            disabled={isRepairing}
                            className="gap-2"
                        >
                            {isRepairing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Repairing {repairProgress}%
                                </>
                            ) : (
                                <>
                                    <RefreshCcw className="w-4 h-4" />
                                    <span className="hidden sm:inline">Scan & Repair Data</span>
                                </>
                            )}
                        </Button>

                        {/* Header Profile */}
                        {user && (
                            <HeaderProfile />
                        )}
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 flex-1 space-y-8">

                {/* Your Drives Section */}
                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-primary" />
                        Your Drives
                    </h3>

                    {/* Time Period Tabs */}
                    <div className="grid grid-cols-4 bg-muted/50 p-1 rounded-lg mb-6 max-w-md">
                        {(['week', 'month', 'year', 'all'] as TimePeriod[]).map((p) => (
                            <button
                                key={p}
                                onClick={() => setTimePeriod(p)}
                                className={cn(
                                    "text-sm py-2 rounded-md font-medium capitalize transition-all",
                                    timePeriod === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {p}
                            </button>
                        ))}
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div className="p-4 rounded-xl bg-muted/40 border border-border">
                            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Distance</span>
                            <div className="text-2xl font-bold mt-1 text-primary">{formatDistance(cumulativeStats.totalDist)}</div>
                        </div>
                        <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10">
                            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Time</span>
                            <div className="text-2xl font-bold mt-1 text-foreground">{Math.round(cumulativeStats.totalTime / 3600)}h</div>
                        </div>
                        <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10">
                            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Activities</span>
                            <div className="text-2xl font-bold mt-1 text-foreground">{cumulativeStats.count}</div>
                        </div>
                        <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10">
                            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Avg Speed</span>
                            <div className="text-2xl font-bold mt-1 text-foreground">{cumulativeStats.avgSpeed.toFixed(1)} <span className="text-sm">km/h</span></div>
                        </div>
                        <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10">
                            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Max Speed</span>
                            <div className="text-2xl font-bold mt-1 text-foreground">{cumulativeStats.maxSpeed.toFixed(0)} <span className="text-sm">km/h</span></div>
                        </div>
                    </div>
                </div>

                {/* Your Speed Profile Section */}
                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-muted-foreground" />
                        Your Speed Profile
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
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <MapIcon className="w-5 h-5 text-muted-foreground" />
                            {showGlobalHeatmap ? 'Global' : 'Your'} Activity Heatmap
                        </h3>

                        {/* Toggle for Your/Global Heatmap */}
                        <div className="flex items-center gap-3 bg-muted/50 px-3 py-2 rounded-full border border-border/50">
                            <div className={cn(
                                "flex items-center gap-1.5 text-sm font-medium transition-colors",
                                !showGlobalHeatmap ? "text-foreground" : "text-muted-foreground"
                            )}>
                                <User className="w-4 h-4" />
                                Your
                            </div>
                            <Switch
                                id="heatmap-toggle"
                                checked={showGlobalHeatmap}
                                onCheckedChange={setShowGlobalHeatmap}
                            />
                            <div className={cn(
                                "flex items-center gap-1.5 text-sm font-medium transition-colors",
                                showGlobalHeatmap ? "text-foreground" : "text-muted-foreground"
                            )}>
                                <Globe className="w-4 h-4" />
                                Global
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 rounded-xl overflow-hidden border border-border relative z-0">
                        <div ref={mapRef} className="h-full w-full bg-muted/10" />
                    </div>
                </div>
            </main>

            {/* Floating Theme Toggle */}
            <div className="fixed bottom-6 left-6 z-[1050]">
                <ThemeToggle />
            </div>
        </div>
    );
};

export default Analytics;
