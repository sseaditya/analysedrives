import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { MapPin, LogOut, Clock, Activity, Search, LayoutDashboard, Globe, Car, User, BarChart3 } from "lucide-react";
import { formatDistance, formatDuration } from "@/utils/gpxParser";
import { supabase } from "@/lib/supabase";
import ActivityMiniMap from "@/components/ActivityMiniMap";
import { ThemeToggle } from "@/components/ThemeToggle";
import ProfileEditor from "@/components/ProfileEditor";

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
    user_id: string;
    profiles?: {
        display_name: string | null;
        car: string | null;
        avatar_url: string | null;
    };
}

const Feed = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [activities, setActivities] = useState<ActivityRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [profile, setProfile] = useState<Profile | null>(null);
    const [isLoadingProfile, setIsLoadingProfile] = useState(false);

    useEffect(() => {
        fetchPublicActivities();
        fetchProfile();
    }, [user]);

    const fetchProfile = async () => {
        try {
            if (!user) return;
            setIsLoadingProfile(true);
            const { data, error } = await supabase
                .from('profiles')
                .select('id, display_name, car, avatar_url')
                .eq('id', user.id)
                .single();

            if (data) setProfile(data);
        } catch (err) {
            console.error("Error fetching profile:", err);
        } finally {
            setIsLoadingProfile(false);
        }
    };

    const fetchPublicActivities = async () => {
        try {
            const { data, error } = await supabase
                .from('activities')
                .select('*, profiles:user_id(display_name, car, avatar_url)')
                .eq('public', true)
                .order('created_at', { ascending: false });

            if (error) throw error;

            setActivities(data || []);
        } catch (err) {
            console.error("Error fetching feed:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate("/");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    // Filter locally by search
    const filteredActivities = activities.filter(a =>
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.profiles?.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.profiles?.car?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            {/* Header */}
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-shrink-0 cursor-pointer" onClick={() => navigate('/dashboard')}>
                        <span className="font-serif font-bold text-xl text-foreground hidden md:block tracking-tight">AnalyseDrive</span>
                    </div>

                    {/* Search Bar */}
                    <div className="flex-1 max-w-md relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search community drives..."
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
                        <ProfileEditor onProfileUpdate={(updatedProfile) => setProfile(updatedProfile)}>
                            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                                {isLoadingProfile ? (
                                    <>
                                        <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
                                        <div className="h-4 w-24 bg-muted animate-pulse rounded hidden md:block" />
                                    </>
                                ) : (
                                    <>
                                        <img
                                            src={profile?.avatar_url || user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.display_name || user?.email || "U")}&background=random`}
                                            alt={profile?.display_name || user?.email || "User"}
                                            className="w-8 h-8 rounded-full border border-border object-cover"
                                            crossOrigin="anonymous"
                                        />
                                        <span className="text-sm font-medium hidden md:block">
                                            {profile?.display_name || user?.user_metadata?.full_name || user?.email}
                                        </span>
                                    </>
                                )}
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
                <div className="max-w-7xl mx-auto space-y-6">
                    {/* Controls Header */}
                    <div className="space-y-2">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                {/* Tab Navigation */}
                                <div className="flex items-center bg-muted/50 p-1 rounded-lg">
                                    <button
                                        onClick={() => navigate('/dashboard')}
                                        className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        My Activities
                                    </button>
                                    <button
                                        className="px-4 py-1.5 rounded-md text-sm font-medium bg-background text-foreground shadow-sm transition-colors"
                                    >
                                        Community Feed
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground">Explore public drives from the community</p>
                    </div>

                    {loading ? (
                        <div className="text-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                        </div>
                    ) : filteredActivities.length === 0 ? (
                        <div className="text-center py-20 bg-muted/20 rounded-2xl border border-dashed border-border">
                            <Globe className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                            <p className="text-muted-foreground text-lg">No public activities found.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredActivities.map((activity) => (
                                <div
                                    key={activity.id}
                                    onClick={() => navigate(`/activity/${activity.id}`)}
                                    className="group bg-card border border-border rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all cursor-pointer hover:-translate-y-1 flex flex-col relative"
                                >
                                    {/* Map Preview with Overlay */}
                                    <div className="h-48 w-full relative bg-muted/30">
                                        <ActivityMiniMap coordinates={activity.stats?.previewCoordinates} />

                                        {/* User Info Overlay */}
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 flex items-end justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full border border-white/20 bg-muted overflow-hidden shrink-0">
                                                    <img
                                                        src={activity.profiles?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(activity.profiles?.display_name || "U")}&background=random`}
                                                        alt={activity.profiles?.display_name || "User"}
                                                        className="w-full h-full object-cover"
                                                        crossOrigin="anonymous"
                                                    />
                                                </div>
                                                <div className="text-white min-w-0">
                                                    <p className="text-sm font-bold truncate">
                                                        {activity.profiles?.display_name || "Anonymous User"}
                                                    </p>
                                                    {activity.profiles?.car && (
                                                        <p className="text-xs text-white/80 truncate flex items-center gap-1">
                                                            <Car className="w-3 h-3" />
                                                            {activity.profiles.car}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Details */}
                                    <div className="p-4 flex-1">
                                        <h3 className="font-bold text-foreground mb-4 truncate" title={activity.title}>
                                            {activity.title}
                                        </h3>

                                        <div className="grid grid-cols-3 gap-2 border-t border-border/50 pt-4">
                                            <div>
                                                <span className="text-[10px] uppercase text-muted-foreground font-semibold">Dist</span>
                                                <div className="flex items-center gap-1 font-bold text-sm">
                                                    <MapPin className="w-3 h-3 text-primary" />
                                                    {formatDistance(activity.stats?.totalDistance || 0)}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-[10px] uppercase text-muted-foreground font-semibold">Time</span>
                                                <div className="flex items-center gap-1 font-bold text-sm">
                                                    <Clock className="w-3 h-3 text-primary" />
                                                    {formatDuration(activity.stats?.totalTime || 0)}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-[10px] uppercase text-muted-foreground font-semibold">Avg</span>
                                                <div className="flex items-center gap-1 font-bold text-sm">
                                                    <Activity className="w-3 h-3 text-primary" />
                                                    {activity.stats?.avgSpeed ? `${activity.stats.avgSpeed.toFixed(0)}` : '-'}
                                                    <span className="text-[10px] font-normal text-muted-foreground">km/h</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Floating Theme Toggle */}
            <div className="fixed bottom-6 left-6 z-[1050]">
                <ThemeToggle />
            </div>
        </div>
    );
};

export default Feed;
