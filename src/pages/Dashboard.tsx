import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { MapPin, LogOut, Upload, Activity, Calendar, Clock, ArrowRight, TrendingUp, Pencil, Trash2, Check, X, Search, SlidersHorizontal, ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import FileUploader from "@/components/FileUploader";
import { parseGPX, calculateStats, formatDistance, formatDuration, generatePreviewPolyline, calculateSpeedDistribution, SpeedBucket } from "@/utils/gpxParser";
import { supabase } from "@/lib/supabase";
import ActivityMiniMap from "@/components/ActivityMiniMap";
import { cn } from "@/lib/utils";
import StravaImport from "@/components/StravaImport";
import ProfileEditor from "@/components/ProfileEditor";
import { Slider } from "@/components/ui/slider";
import SpeedDistributionChart from "@/components/SpeedDistributionChart";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Profile {
    id: string;
    display_name: string | null;
    car: string | null;
    avatar_url: string | null;
}

interface ActivityRecord {
    id: string;
    title: string;
    file_path: string;
    created_at: string;
    stats: any;
}

type TimePeriod = 'week' | 'month' | 'year' | 'all';

const Dashboard = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activities, setActivities] = useState<ActivityRecord[]>([]);
    const [loadingActivities, setLoadingActivities] = useState(true);
    const [showUpload, setShowUpload] = useState(false);
    const [profile, setProfile] = useState<Profile | null>(null);

    // Search and Filters
    const [searchQuery, setSearchQuery] = useState("");
    const [showFilters, setShowFilters] = useState(false);
    const [timeFilter, setTimeFilter] = useState<[number, number]>([0, 24]); // Hours
    const [distFilter, setDistFilter] = useState<[number, number]>([0, 1000]); // km
    const [speedFilter, setSpeedFilter] = useState<[number, number]>([0, 200]); // km/h
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');

    // Edit State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState("");

    const handleStartEdit = (e: React.MouseEvent, activity: ActivityRecord) => {
        e.stopPropagation();
        setEditingId(activity.id);
        setEditTitle(activity.title);
    };

    const handleCancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(null);
        setEditTitle("");
    };

    const handleSaveEdit = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!editTitle.trim()) return;

        try {
            const { error } = await supabase
                .from('activities')
                .update({ title: editTitle.trim() })
                .eq('id', id);

            if (error) throw error;

            // Optimistic update
            setActivities(prev => prev.map(a => a.id === id ? { ...a, title: editTitle.trim() } : a));
            setEditingId(null);
        } catch (err) {
            console.error("Error updating title:", err);
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string, filePath: string) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this activity? This cannot be undone.")) return;

        try {
            // 1. Delete file from Storage
            const { error: storageError } = await supabase.storage
                .from('gpx-files')
                .remove([filePath]);

            if (storageError) {
                console.error("Storage delete error:", storageError);
            }

            // 2. Delete record from Table
            const { error: dbError } = await supabase
                .from('activities')
                .delete()
                .eq('id', id);

            if (dbError) throw dbError;

            // Optimistic Remove
            setActivities(prev => prev.filter(a => a.id !== id));

        } catch (err) {
            console.error("Error deleting activity:", err);
            alert("Failed to delete activity.");
        }
    };

    useEffect(() => {
        fetchProfile();
        fetchActivities();

        // Check for strava connection success param to auto-open upload
        const params = new URLSearchParams(window.location.search);
        if (params.get('strava') === 'connected') {
            setShowUpload(true);
            window.history.replaceState({}, '', '/dashboard'); // Clean URL
        }
    }, [user]);

    const fetchProfile = async () => {
        if (!user) return;
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, display_name, car, avatar_url')
                .eq('id', user.id)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            if (data) setProfile(data);
        } catch (err) {
            console.error("Error fetching profile:", err);
        }
    };

    const fetchActivities = async () => {
        if (!user) return;
        try {
            const { data, error } = await supabase
                .from('activities')
                .select('*')
            if (error) throw error;

            // Sort by activity date (startTime) if available, otherwise fallback to created_at
            const sortedData = (data || []).sort((a, b) => {
                const dateA = a.stats?.startTime ? new Date(a.stats.startTime).getTime() : new Date(a.created_at).getTime();
                const dateB = b.stats?.startTime ? new Date(b.stats.startTime).getTime() : new Date(b.created_at).getTime();
                return dateB - dateA;
            });

            setActivities(sortedData);

            // Initialize filter bounds based on data
            if (sortedData.length > 0) {
                const maxTime = Math.ceil(Math.max(...sortedData.map(a => (a.stats?.totalTime || 0) / 3600)) + 1);
                const maxDist = Math.ceil(Math.max(...sortedData.map(a => (a.stats?.totalDistance || 0))) + 10);
                const maxSpeed = Math.ceil(Math.max(...sortedData.map(a => (a.stats?.maxSpeed || 0))) + 10);

                setTimeFilter([0, maxTime]);
                setDistFilter([0, maxDist]);
                setSpeedFilter([0, maxSpeed]);
            }
        } catch (err) {
            console.error("Error fetching activities:", err);
        } finally {
            setLoadingActivities(false);
        }
    };

    // --- Computed Data ---

    const filteredActivities = useMemo(() => {
        return activities.filter(activity => {
            // 1. Search (Title)
            if (searchQuery && !activity.title.toLowerCase().includes(searchQuery.toLowerCase())) {
                return false;
            }

            const stats = activity.stats || {};
            const timeHours = (stats.totalTime || 0) / 3600;
            const distKm = stats.totalDistance || 0;
            const avgSpeed = stats.avgSpeed || 0;

            // 2. Filters
            // Time: Check range. If slider is at max, treat as "and above" for the upper bound? 
            // The user asked for "greater than". Range slider covers this if min is set high.
            // Let's just use strict range for now, but ensure max is dynamic.
            if (timeHours < timeFilter[0] || timeHours > timeFilter[1]) return false;
            if (distKm < distFilter[0] || distKm > distFilter[1]) return false;
            if (avgSpeed < speedFilter[0] || avgSpeed > speedFilter[1]) return false;

            return true;
        });
    }, [activities, searchQuery, timeFilter, distFilter, speedFilter]);

    const cumulativeStats = useMemo(() => {
        // First filter by Time Period
        const now = new Date();
        const periodActivities = filteredActivities.filter(a => {
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
        const totalElevation = periodActivities.reduce((acc, curr) => acc + (curr.stats?.elevationGain || 0), 0);
        // Weighted Average Speed = Total Distance / Total Time
        const avgSpeed = totalTime > 0 ? totalDist / (totalTime / 3600) : 0;
        const maxSpeed = Math.max(...periodActivities.map(a => a.stats?.maxSpeed || 0), 0);

        return {
            count,
            totalDist,
            totalTime,
            totalElevation,
            avgSpeed,
            maxSpeed,
            activities: periodActivities // Pass for chart
        };
    }, [filteredActivities, timePeriod]);

    const aggregatedSpeedDistribution = useMemo(() => {
        // Aggregate buckets from all valid activities in the current period
        const bucketMap = new Map<number, { minSpeed: number, time: number, distance: number }>();

        cumulativeStats.activities.forEach(activity => {
            const dist = activity.stats?.speedDistribution;
            if (Array.isArray(dist)) {
                dist.forEach((bucket: any) => {
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
    }, [cumulativeStats]);

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate("/login");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const handleFilesLoad = async (files: { content: string; name: string }[]) => {
        if (!user) return;
        setIsLoading(true);
        setError(null);
        let successCount = 0;
        const errorMessages: string[] = [];

        try {
            // Process files sequentially to avoid rate limits or race conditions
            for (const { content, name } of files) {
                try {
                    // 1. Local Parse & Validation
                    const parsedPoints = parseGPX(content);
                    if (parsedPoints.length === 0) {
                        errorMessages.push(`Skipped ${name}: No GPS points.`);
                        continue;
                    }
                    const calculatedStats = calculateStats(parsedPoints);
                    const previewCoordinates = generatePreviewPolyline(parsedPoints);

                    // 2. Upload to Supabase Storage
                    const fileName = `${user.id}/${Date.now()}_${name}`;
                    const { error: uploadError } = await supabase.storage
                        .from('gpx-files')
                        .upload(fileName, new Blob([content], { type: 'text/xml' }));

                    if (uploadError) throw uploadError;

                    // 3. Insert Record into 'activities' table
                    const { error: dbError } = await supabase
                        .from('activities')
                        .insert([
                            {
                                user_id: user.id,
                                title: name.replace('.gpx', ''),
                                file_path: fileName,
                                stats: {
                                    ...calculatedStats,
                                    previewCoordinates
                                },
                            }
                        ]);

                    if (dbError) throw dbError;
                    successCount++;
                } catch (err) {
                    console.error(`Error processing ${name}:`, err);
                    errorMessages.push(`Failed ${name}`);
                }
            }

            // 4. Refresh List & UI
            await fetchActivities();

            if (successCount === files.length) {
                // All success
                setShowUpload(false);
            } else {
                // Partial or no success
                setError(`Uploaded ${successCount}/${files.length}. Errors: ${errorMessages.join(', ')}`);
            }

        } catch (err) {
            setError("Failed to upload activities.");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Dashboard Header */}
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-bold text-xl text-foreground hidden md:block">AnalyseDrive</span>
                    </div>

                    {/* Search Bar */}
                    <div className="flex-1 max-w-md relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search drives..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-muted/50 border border-border rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate('/analytics')}
                            className="text-muted-foreground hover:text-primary gap-2 mr-2"
                        >
                            <BarChart3 className="w-4 h-4" />
                            <span className="hidden md:inline">Analytics</span>
                        </Button>
                        <div className="mr-2">
                            <ThemeToggle />
                        </div>
                        <ProfileEditor onProfileUpdate={(updatedProfile) => setProfile(updatedProfile)}>
                            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                                <img
                                    src={profile?.avatar_url || user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.display_name || user?.email || "U")}&background=random`}
                                    alt={profile?.display_name || user?.email || "User"}
                                    className="w-8 h-8 rounded-full border border-border object-cover"
                                />
                                <span className="text-sm font-medium hidden md:block">
                                    {profile?.display_name || user?.user_metadata?.full_name || user?.email}
                                </span>
                            </div>
                        </ProfileEditor>
                        <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-destructive">
                            <LogOut className="w-4 h-4 mr-2" />
                            Sign Out
                        </Button>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 flex-1">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left Sidebar: Cumulative Stats (3 cols) */}
                    <div className="hidden lg:block lg:col-span-3 space-y-6">
                        <div className="bg-card border border-border rounded-2xl p-6 sticky top-24 space-y-8">
                            <div>
                                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-primary" />
                                    Your Progress
                                </h3>

                                {/* Time Period Tabs */}
                                <div className="grid grid-cols-4 bg-muted/50 p-1 rounded-lg mb-6">
                                    {(['week', 'month', 'year', 'all'] as TimePeriod[]).map((p) => (
                                        <button
                                            key={p}
                                            onClick={() => setTimePeriod(p)}
                                            className={cn(
                                                "text-[10px] py-1.5 rounded-md font-medium capitalize transition-all",
                                                timePeriod === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>

                                {/* Main Stats */}
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-muted/40 border border-border">
                                        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Distance</span>
                                        <div className="text-2xl font-bold mt-1 text-primary">{formatDistance(cumulativeStats.totalDist)}</div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/10">
                                            <span className="text-[10px] text-muted-foreground font-semibold uppercase">Total Time</span>
                                            <div className="text-lg font-bold mt-1 text-foreground">{Math.round(cumulativeStats.totalTime / 3600)}h</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/10">
                                            <span className="text-[10px] text-muted-foreground font-semibold uppercase">Activities</span>
                                            <div className="text-lg font-bold mt-1 text-foreground">{cumulativeStats.count}</div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/10">
                                            <span className="text-[10px] text-muted-foreground font-semibold uppercase">Avg Speed</span>
                                            <div className="text-lg font-bold mt-1 text-foreground">{cumulativeStats.avgSpeed.toFixed(1)} <span className="text-xs">km/h</span></div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/10">
                                            <span className="text-[10px] text-muted-foreground font-semibold uppercase">Max Speed</span>
                                            <div className="text-lg font-bold mt-1 text-foreground">{cumulativeStats.maxSpeed.toFixed(0)} <span className="text-xs">km/h</span></div>
                                        </div>
                                    </div>
                                </div>
                            </div>


                        </div>
                    </div>

                    {/* Main Feed (9 cols) */}
                    <div className="col-span-1 lg:col-span-9 space-y-6">

                        {/* Controls Header */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <h2 className="text-2xl font-bold flex items-center gap-2">
                                    <Activity className="w-6 h-6" />
                                    My Activities
                                </h2>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowFilters(!showFilters)}
                                    className={cn("gap-2", showFilters && "bg-muted text-foreground")}
                                >
                                    <SlidersHorizontal className="w-4 h-4" />
                                    Filters
                                    {(showFilters || (filteredActivities.length !== activities.length)) && (
                                        <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full">
                                            {filteredActivities.length}
                                        </span>
                                    )}
                                </Button>
                            </div>

                            <Button
                                size="sm"
                                onClick={() => setShowUpload(!showUpload)}
                                variant={showUpload ? "secondary" : "default"}
                            >
                                <Upload className="w-4 h-4 mr-2" />
                                {showUpload ? "Cancel Upload" : "Add Activity"}
                            </Button>
                        </div>

                        {/* Collapsible Filter Panel */}
                        {showFilters && (
                            <div className="bg-card border border-border rounded-2xl p-6 animate-in slide-in-from-top-2">
                                <h3 className="text-sm font-semibold mb-6">Filter Activities</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Time Filter */}
                                    <div className="space-y-4">
                                        <div className="flex justify-between text-xs">
                                            <span className="font-medium text-muted-foreground">Duration</span>
                                            <span className="font-mono">{timeFilter[0]}h - {timeFilter[1]}h+</span>
                                        </div>
                                        <Slider
                                            value={timeFilter}
                                            min={0}
                                            max={24} // Should be dynamic max but 24 is reasonable base
                                            step={0.5}
                                            onValueChange={(val: [number, number]) => setTimeFilter(val)}
                                        />
                                    </div>
                                    {/* Distance Filter */}
                                    <div className="space-y-4">
                                        <div className="flex justify-between text-xs">
                                            <span className="font-medium text-muted-foreground">Distance</span>
                                            <span className="font-mono">{distFilter[0]}km - {distFilter[1]}km</span>
                                        </div>
                                        <Slider
                                            value={distFilter}
                                            min={0}
                                            max={1000} // Dynamic or fixed large?
                                            step={10}
                                            onValueChange={(val: [number, number]) => setDistFilter(val)}
                                        />
                                    </div>
                                    {/* Speed Filter */}
                                    <div className="space-y-4">
                                        <div className="flex justify-between text-xs">
                                            <span className="font-medium text-muted-foreground">Avg Speed</span>
                                            <span className="font-mono">{speedFilter[0]} - {speedFilter[1]} km/h</span>
                                        </div>
                                        <Slider
                                            value={speedFilter}
                                            min={0}
                                            max={200}
                                            step={5}
                                            onValueChange={(val: [number, number]) => setSpeedFilter(val)}
                                        />
                                    </div>
                                </div>
                                <div className="mt-6 flex justify-end">
                                    <Button variant="ghost" size="sm" onClick={() => {
                                        setTimeFilter([0, 24]);
                                        setDistFilter([0, 1000]);
                                        setSpeedFilter([0, 200]);
                                    }} className="text-xs text-muted-foreground hover:text-foreground">
                                        Reset Filters
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Collapsible Upload Section */}
                        <div className={cn(
                            "grid transition-all duration-300 ease-in-out overflow-hidden",
                            showUpload ? "grid-rows-[1fr] opacity-100 mb-6" : "grid-rows-[0fr] opacity-0"
                        )}>
                            <div className="min-h-0">
                                <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-primary/5">
                                    <h3 className="text-lg font-semibold mb-6">Add New Activity</h3>

                                    <div className="space-y-8">
                                        {/* Strava Section */}
                                        <div className="bg-muted/20 border border-border rounded-xl p-5">
                                            <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-foreground">
                                                <Activity className="w-4 h-4 text-[#FC4C02]" />
                                                Import from Strava
                                            </h4>
                                            <StravaImport onImportComplete={() => {
                                                fetchActivities();
                                                setTimeout(() => setShowUpload(false), 1000);
                                            }} />
                                        </div>

                                        <div className="relative flex items-center py-2">
                                            <div className="flex-grow border-t border-border"></div>
                                            <span className="flex-shrink-0 mx-4 text-xs font-semibold uppercase text-muted-foreground">Or</span>
                                            <div className="flex-grow border-t border-border"></div>
                                        </div>

                                        {/* GPX Section */}
                                        <div>
                                            <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-foreground">
                                                <Upload className="w-4 h-4 text-primary" />
                                                Upload GPX File
                                            </h4>
                                            <FileUploader onFilesLoad={handleFilesLoad} isLoading={isLoading} />
                                        </div>
                                    </div>

                                    {error && (
                                        <p className="mt-4 text-sm text-destructive bg-destructive/10 p-3 rounded-lg text-center">
                                            {error}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Activity Grid */}
                        <div>
                            {loadingActivities ? (
                                <div className="text-center py-12">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                                </div>
                            ) : filteredActivities.length === 0 ? (
                                <div className="text-center py-12 bg-muted/30 rounded-2xl border border-dashed border-border">
                                    <p className="text-muted-foreground">No activities found matching your criteria.</p>
                                    <Button variant="link" onClick={() => { setSearchQuery(''); setShowFilters(false); }}>Clear filters</Button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {filteredActivities.map((activity) => (
                                        <div
                                            key={activity.id}
                                            onClick={() => navigate(`/activity/${activity.id}`)}
                                            className="group bg-card border border-border rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all cursor-pointer hover:-translate-y-1 flex flex-col relative"
                                        >
                                            {/* Mini Map */}
                                            <div className="h-40 w-full relative bg-muted/30">
                                                <ActivityMiniMap coordinates={activity.stats?.previewCoordinates} />
                                                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                                                    {/* Actions Bubble */}
                                                    <div className="bg-background/80 backdrop-blur-sm p-1.5 rounded-full shadow-sm flex items-center gap-1">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-6 w-6 hover:text-primary"
                                                            onClick={(e) => handleStartEdit(e, activity)}
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-6 w-6 hover:text-destructive"
                                                            onClick={(e) => handleDelete(e, activity.id, activity.file_path)}
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Details */}
                                            <div className="p-4 flex-1 flex flex-col justify-between">
                                                <div className="mb-4">
                                                    {editingId === activity.id ? (
                                                        <div className="flex items-center gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
                                                            <input
                                                                type="text"
                                                                value={editTitle}
                                                                onChange={(e) => setEditTitle(e.target.value)}
                                                                className="flex-1 bg-background border border-primary rounded px-2 py-1 text-sm focus:outline-none"
                                                                autoFocus
                                                            />
                                                            <Button size="icon" variant="ghost" className="h-6 w-6 text-green-500" onClick={(e) => handleSaveEdit(e, activity.id)}>
                                                                <Check className="w-4 h-4" />
                                                            </Button>
                                                            <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={handleCancelEdit}>
                                                                <X className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex justify-between items-start gap-2">
                                                            <h4 className="font-bold text-foreground truncate flex-1" title={activity.title}>
                                                                {activity.title}
                                                            </h4>
                                                        </div>
                                                    )}

                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        {new Date(activity.stats?.startTime || activity.created_at).toLocaleDateString(undefined, {
                                                            weekday: 'short',
                                                            year: 'numeric',
                                                            month: 'short',
                                                            day: 'numeric'
                                                        })}
                                                    </p>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2 mt-auto pt-4 border-t border-border/50">
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] uppercase text-muted-foreground font-medium">Dist</span>
                                                        <span className="text-sm font-bold flex items-center gap-1">
                                                            <MapPin className="w-3 h-3 text-primary" />
                                                            {formatDistance(activity.stats?.totalDistance || 0)}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] uppercase text-muted-foreground font-medium">Time</span>
                                                        <span className="text-sm font-bold flex items-center gap-1">
                                                            <Clock className="w-3 h-3 text-primary" />
                                                            {formatDuration(activity.stats?.totalTime || 0)}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] uppercase text-muted-foreground font-medium">Avg</span>
                                                        <span className="text-sm font-bold flex items-center gap-1">
                                                            <Activity className="w-3 h-3 text-primary" />
                                                            {activity.stats?.avgSpeed ? `${activity.stats.avgSpeed.toFixed(1)}` : '-'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
            {/* Floating Theme Toggle */}
            <div className="fixed bottom-6 right-6 z-[1050]">
                <ThemeToggle />
            </div>
        </div>
    );
};
export default Dashboard;
