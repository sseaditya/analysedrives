import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { MapPin, LogOut, Clock, Activity, Search, Globe, Car, BarChart3, ChevronLeft, ChevronRight, LogIn, Route } from "lucide-react";
import { formatDistance } from "@/utils/gpxParser";
import { supabase } from "@/lib/supabase";
import ActivityMiniMap from "@/components/ActivityMiniMap";
import { ThemeToggle } from "@/components/ThemeToggle";
import ProfileEditor from "@/components/ProfileEditor";

interface Profile {
    id: string;
    display_name: string | null;
    full_name: string | null;
    car: string | null;
    avatar_url: string | null;
}

interface ActivityStats {
    startTime?: string;
    previewCoordinates?: [number, number][];
    totalDistance?: number;
    totalTime?: number;
    avgSpeed?: number;
}

interface ActivityRecord {
    id: string;
    slug: number | null;
    title: string;
    file_path: string;
    created_at: string;
    stats: ActivityStats | null;
    user_id: string;
    profiles?: {
        display_name: string | null;
        full_name: string | null;
        car: string | null;
        avatar_url: string | null;
    };
}

const Feed = () => {
    const { user, signOut, signInWithGoogle } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [activities, setActivities] = useState<ActivityRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [profile, setProfile] = useState<Profile | null>(() => {
        if (!user) return null;
        const cached = localStorage.getItem(`profile_${user.id}`);
        if (cached) {
            try { return JSON.parse(cached); } catch (e) { /* ignore */ }
        }
        return {
            id: user.id,
            display_name: user.user_metadata?.full_name || user.user_metadata?.display_name || null,
            full_name: user.user_metadata?.full_name || null,
            car: null,
            avatar_url: user.user_metadata?.avatar_url || null
        };
    });
    const [isLoadingProfile, setIsLoadingProfile] = useState(false);
    const isMounted = useRef(false);

    // Pagination via URL search params
    const [searchParams, setSearchParams] = useSearchParams();
    const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const itemsPerPage = 12;

    const setCurrentPage = (pageOrUpdater: number | ((prev: number) => number)) => {
        const newPage = typeof pageOrUpdater === 'function' ? pageOrUpdater(currentPage) : pageOrUpdater;
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (newPage <= 1) {
                next.delete('page');
            } else {
                next.set('page', String(newPage));
            }
            return next;
        }, { replace: false });
    };

    useEffect(() => {
        // Backup current path to sessionStorage for robust back navigation
        const currentPath = `${location.pathname}?${searchParams.toString()}`;
        sessionStorage.setItem('lastListPath', currentPath);
    }, [location.pathname, searchParams]);

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
                .select('id, display_name, full_name, car, avatar_url')
                .eq('id', user.id)
                .single();

            if (data) {
                setProfile(data);
                localStorage.setItem(`profile_${user.id}`, JSON.stringify(data));
            }
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
                .select('*, profiles:user_id(display_name, full_name, car, avatar_url)')
                .eq('public', true)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Sort by activity date (startTime) if available, otherwise fallback to created_at
            const sortedData = (data || []).sort((a, b) => {
                const dateA = a.stats?.startTime ? new Date(a.stats.startTime).getTime() : new Date(a.created_at).getTime();
                const dateB = b.stats?.startTime ? new Date(b.stats.startTime).getTime() : new Date(b.created_at).getTime();
                return dateB - dateA;
            });

            setActivities(sortedData);
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

    // Reset to page 1 when search changes (skip initial mount)
    useEffect(() => {
        if (isMounted.current) {
            setCurrentPage(1);
        } else {
            isMounted.current = true;
        }
    }, [searchQuery]);

    // Pagination computed values
    const totalPages = Math.ceil(filteredActivities.length / itemsPerPage);
    const paginatedActivities = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return filteredActivities.slice(startIndex, startIndex + itemsPerPage);
    }, [filteredActivities, currentPage, itemsPerPage]);

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            {/* Header */}
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => navigate(user ? '/dashboard' : '/')}>
                        <span className="font-bold text-xl text-foreground hidden md:block">DrivenStat</span>
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
                        {user ? (
                            <>
                                <Button variant="ghost" size="sm" onClick={() => navigate('/segments')} className="text-muted-foreground hover:text-primary gap-2">
                                    <Route className="w-4 h-4" />
                                    <span className="hidden md:inline">Segments</span>
                                </Button>
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
                                                    src={profile?.avatar_url || user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.display_name || profile?.full_name || user.user_metadata?.full_name || user.email || "U")}&background=random`}
                                                    alt={profile?.display_name || profile?.full_name || user.user_metadata?.full_name || user.email || "User"}
                                                    className="w-8 h-8 rounded-full border border-border object-cover"
                                                    crossOrigin="anonymous"
                                                />
                                                <span className="text-sm font-medium hidden md:block">
                                                    {profile?.display_name || profile?.full_name || user.user_metadata?.full_name || user.email}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </ProfileEditor>
                                <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-destructive">
                                    <LogOut className="w-4 h-4 mr-2" />
                                    Sign Out
                                </Button>
                            </>
                        ) : (
                            <Button size="sm" onClick={() => signInWithGoogle()} className="gap-2">
                                <LogIn className="w-4 h-4" />
                                Log In
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <main className={`container mx-auto px-4 py-8 flex-1 ${!user ? 'pb-36 md:pb-32' : ''}`}>
                <div className="max-w-7xl mx-auto space-y-6">
                    {/* Controls Header */}
                    <div className="space-y-2">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                {/* Tab Navigation */}
                                <div className="flex items-center bg-muted/50 p-1 rounded-lg">
                                    <button
                                        onClick={() => user ? navigate('/dashboard') : signInWithGoogle()}
                                        className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {user ? 'My Activities' : 'Upload Drive'}
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
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {paginatedActivities.map((activity) => (
                                    <div
                                        key={activity.id}
                                        onClick={() => navigate(`/activity/${activity.slug || activity.id}`, { state: { from: `${location.pathname}?${searchParams.toString()}` } })}
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
                                                            src={activity.profiles?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(activity.profiles?.display_name || activity.profiles?.full_name || "U")}&background=random`}
                                                            alt={activity.profiles?.display_name || activity.profiles?.full_name || "User"}
                                                            className="w-full h-full object-cover"
                                                            crossOrigin="anonymous"
                                                        />
                                                    </div>
                                                    <div className="text-white min-w-0">
                                                        <p className="text-sm font-bold truncate">
                                                            {activity.profiles?.display_name || activity.profiles?.full_name || "Anonymous User"}
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
                                                        {(() => {
                                                            const totalSeconds = activity.stats?.totalTime || 0;
                                                            const h = Math.floor(totalSeconds / 3600);
                                                            const m = Math.floor((totalSeconds % 3600) / 60);
                                                            return h > 0 ? `${h}h ${m}m` : `${m}m`;
                                                        })()}
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

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-4 mt-8 pt-6 border-t border-border">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="gap-1"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                        Previous
                                    </Button>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-muted-foreground">
                                            Page <span className="font-bold text-foreground">{currentPage}</span> of <span className="font-bold text-foreground">{totalPages}</span>
                                        </span>
                                        <span className="text-xs text-muted-foreground">({filteredActivities.length} activities)</span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="gap-1"
                                    >
                                        Next
                                        <ChevronRight className="w-4 h-4" />
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>

            {!user && (
                <div className="fixed bottom-0 left-0 right-0 z-[1002] border-t border-primary/20 bg-background/95 backdrop-blur-md shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-full duration-700 delay-500">
                    <div className="container mx-auto px-3 py-3 md:py-4 flex flex-col md:flex-row items-center justify-between gap-2 max-w-5xl">
                        <div className="text-center md:text-left space-y-1">
                            <h3 className="font-bold text-base md:text-lg flex items-center justify-center md:justify-start gap-2">
                                <Globe className="w-4 h-4 text-primary" />
                                Explore Public Drives
                            </h3>
                            <p className="text-sm text-muted-foreground max-w-xl">
                                Sign in for free to upload your own drives, save activities, and use advanced analysis tools.
                            </p>
                        </div>
                        <Button
                            onClick={() => signInWithGoogle()}
                            size="lg"
                            className="shrink-0 w-full md:w-auto shadow-lg shadow-primary/20 gap-2 font-semibold"
                        >
                            <LogIn className="w-4 h-4" />
                            Sign in with Google
                        </Button>
                    </div>
                </div>
            )}

            {/* Floating Theme Toggle */}
            <div className="fixed bottom-6 left-6 z-[1050]">
                <ThemeToggle />
            </div>
        </div>
    );
};

export default Feed;
