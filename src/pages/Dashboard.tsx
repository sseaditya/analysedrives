import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { MapPin, LogOut, Upload, Activity, Calendar, Clock, ArrowRight, TrendingUp, Pencil, Trash2, Check, X } from "lucide-react";
import FileUploader from "@/components/FileUploader";
import { parseGPX, calculateStats, formatDistance, formatDuration, generatePreviewPolyline } from "@/utils/gpxParser";
import { supabase } from "@/lib/supabase";
import ActivityMiniMap from "@/components/ActivityMiniMap";
import { cn } from "@/lib/utils";

interface ActivityRecord {
    id: string;
    title: string;
    file_path: string;
    created_at: string;
    stats: any;
}

const Dashboard = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activities, setActivities] = useState<ActivityRecord[]>([]);
    const [loadingActivities, setLoadingActivities] = useState(true);
    const [showUpload, setShowUpload] = useState(false);

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
        fetchActivities();
    }, [user]);

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
        } catch (err) {
            console.error("Error fetching activities:", err);
        } finally {
            setLoadingActivities(false);
        }
    };

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
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-xl text-foreground hidden md:block">AnalyseDrive</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            {user?.user_metadata?.avatar_url && (
                                <img
                                    src={user.user_metadata.avatar_url}
                                    alt={user.email || "User"}
                                    className="w-8 h-8 rounded-full border border-border"
                                />
                            )}
                            <span className="text-sm font-medium hidden md:block">
                                {user?.user_metadata?.full_name || user?.email}
                            </span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-destructive">
                            <LogOut className="w-4 h-4 mr-2" />
                            Sign Out
                        </Button>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 flex-1">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Sidebar / Statistics */}
                    <div className="hidden lg:block space-y-6">
                        <div className="bg-card border border-border rounded-2xl p-6 sticky top-24">
                            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                Statistics
                            </h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                                    <span className="text-sm text-muted-foreground">Total Activities</span>
                                    <span className="font-bold">{activities.length}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                                    <span className="text-sm text-muted-foreground">Total Distance</span>
                                    <span className="font-bold">
                                        {formatDistance(activities.reduce((acc, curr) => acc + (curr.stats?.totalDistance || 0), 0))}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Feed */}
                    <div className="lg:col-span-3 space-y-6">

                        {/* Header & Upload Button */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <Activity className="w-6 h-6" />
                                My Activities
                            </h2>
                            <Button
                                size="sm"
                                onClick={() => setShowUpload(!showUpload)}
                                variant={showUpload ? "secondary" : "default"}
                            >
                                <Upload className="w-4 h-4 mr-2" />
                                {showUpload ? "Cancel Upload" : "Upload GPX"}
                            </Button>
                        </div>

                        {/* Collapsible Upload Section */}
                        <div className={cn(
                            "grid transition-all duration-300 ease-in-out overflow-hidden",
                            showUpload ? "grid-rows-[1fr] opacity-100 mb-6" : "grid-rows-[0fr] opacity-0"
                        )}>
                            <div className="min-h-0">
                                <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-primary/5">
                                    <h3 className="text-lg font-semibold mb-4">Add New Activity</h3>
                                    <FileUploader onFilesLoad={handleFilesLoad} isLoading={isLoading} />
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
                            ) : activities.length === 0 ? (
                                <div className="text-center py-12 bg-muted/30 rounded-2xl border border-dashed border-border">
                                    <p className="text-muted-foreground">No activities found. Upload to start tracking!</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {activities.map((activity) => (
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

                                                <div className="grid grid-cols-2 gap-2 mt-auto pt-4 border-t border-border/50">
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] uppercase text-muted-foreground font-medium">Distance</span>
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
        </div>
    );
};
export default Dashboard;
