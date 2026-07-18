import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Pencil, Trash2, Loader2, ArrowLeft, Globe, Lock, Fuel, Check, LogIn, Maximize2, Minimize2, Film, Share2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import GPSStats from "@/components/GPSStats";
import { GPXStats, GPXPoint } from "@/utils/gpxParser";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import ActivityEditor from "@/components/ActivityEditor";
import { useIsMobile } from "@/hooks/use-mobile";
import HeaderProfile from "@/components/HeaderProfile";
import VideoGenerator from "@/components/VideoGenerator";
import { createMapShareImage, createTransparentRouteShareImage, downloadImageFile } from "@/utils/shareImage";
import { toast } from "sonner";
import { useTheme } from "@/components/ThemeProvider";
import SegmentCreator from "@/components/SegmentCreator";
import { loadActivityTrack } from "@/lib/activityData";
import { fetchActivitySegmentRanks } from "@/lib/segmentData";
import type { ActivitySegmentRank, ActivitySummary } from "@/types/segments";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ActivityState {
  stats: GPXStats;
  points: GPXPoint[];
  fileName: string;
}

interface ActivityMetadata {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  public: boolean;
  speed_cap: number | null;
  hide_radius: number | null;
  file_path: string;
  fuel: number | null;
}

interface OwnerProfile {
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  car: string | null;
}

const Activity = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const isMobile = useIsMobile();
  const { theme } = useTheme();

  // Initialize state from location state (if uploaded locally) or null
  // strictly check for 'points' to avoid confusing navigation state { from: ... } with activity data
  const [data, setData] = useState<ActivityState | null>(() => {
    const state = location.state as Partial<ActivityState> | null;
    if (state && state.points && state.stats) {
      return state as ActivityState;
    }
    return null;
  });
  const [metadata, setMetadata] = useState<ActivityMetadata | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [segmentRanks, setSegmentRanks] = useState<ActivitySegmentRank[]>([]);

  // Determine ownership
  const isOwner = user && metadata ? user.id === metadata.user_id : false;

  useEffect(() => {
    // Wait for auth to settle before fetching
    if (authLoading) return;

    // If we have an ID and no data yet, fetch from Supabase
    if (id && !data) {
      const fetchActivity = async () => {
        try {
          setLoading(true);
          setAccessDenied(false);

          // 1. Get Metadata - RLS should allow public activities
          // 1. Get Metadata - Support both UUID and numeric Slug
          const isNumeric = /^\d+$/.test(id);
          const query = supabase
            .from('activities')
            .select('*');

          if (isNumeric) {
            query.eq('slug', parseInt(id));
          } else {
            query.eq('id', id);
          }

          const { data: record, error: dbError } = await query.single();

          if (dbError) {
            console.error("DB Error:", dbError);
            if (dbError.code === 'PGRST116') {
              setErrorDetails("Activity not found in database.");
              setAccessDenied(true);
            } else if (dbError.code === '42501') {
              setErrorDetails("Permission denied (Database RLS).");
              setAccessDenied(true);
            } else {
              setErrorDetails(`Database Error: ${dbError.message} (${dbError.code})`);
              setAccessDenied(true);
            }
            setLoading(false);
            return;
          }

          // Check access: if not public and not owner, show access denied
          if (!record.public && (!user || user.id !== record.user_id)) {
            setErrorDetails("This activity is private.");
            setAccessDenied(true);
            setLoading(false);
            return;
          }

          // Save metadata
          setMetadata({
            id: record.id,
            user_id: record.user_id,
            title: record.title,
            description: record.description,
            public: record.public,
            speed_cap: record.speed_cap,
            hide_radius: record.hide_radius,
            file_path: record.file_path,
            fuel: record.fuel
          });

          // 1.5 Fetch owner profile
          const { data: profileData } = await supabase
            .from('profiles')
            .select('display_name, full_name, avatar_url, car')
            .eq('id', record.user_id)
            .single();

          if (profileData) {
            let processedAvatarUrl = profileData.avatar_url;

            // Handle relative paths (legacy or manual data)
            if (processedAvatarUrl && !processedAvatarUrl.startsWith('http')) {
              const { data: urlData } = supabase.storage
                .from('avatars')
                .getPublicUrl(processedAvatarUrl);
              processedAvatarUrl = urlData.publicUrl;
            }

            setOwnerProfile({
              ...profileData,
              avatar_url: processedAvatarUrl
            });
          }

          const loaded = await loadActivityTrack({
            id: record.id,
            slug: record.slug,
            user_id: record.user_id,
            title: record.title,
            file_path: record.file_path,
            created_at: record.created_at,
            public: record.public,
            speed_cap: record.speed_cap,
            hide_radius: record.hide_radius,
            stats: record.stats,
          } as ActivitySummary);

          // Older rides are upgraded once when their owner opens them. The
          // versioned processed file and DB summary then serve future views.
          if (user?.id === record.user_id && !Array.isArray(record.stats?.fastestDistances)) {
            try {
              const processedPath = record.file_path.replace(/\.gpx$/i, '') + '.processed.json';
              const { error: statsUpdateError } = await supabase
                .from('activities')
                .update({
                  stats: {
                    ...(record.stats ?? {}),
                    ...loaded.processedTrack.stats,
                    previewCoordinates: loaded.processedTrack.previewCoordinates,
                  },
                })
                .eq('id', record.id);
              if (statsUpdateError) throw statsUpdateError;

              // The DB summary drives Analytics. Cache replacement is useful
              // but must never prevent the durable stats update.
              const { error: processedUploadError } = await supabase.storage
                .from('gpx-files')
                .upload(processedPath, new Blob([JSON.stringify(loaded.processedTrack)], { type: 'application/json' }), { upsert: true });
              if (processedUploadError) {
                console.warn('Fastest-distance stats were saved, but the processed file cache was not replaced', processedUploadError);
              }
            } catch (upgradeError) {
              console.warn('Activity loaded, but its fastest-distance stats could not be persisted', upgradeError);
            }
          }

          setData({
            stats: loaded.processedTrack.stats,
            points: loaded.points,
            fileName: record.title
          });

        } catch (err: unknown) {
          console.error("Error loading activity:", err);
          setErrorDetails(err instanceof Error ? err.message : "Unknown error occurred");
          setAccessDenied(true);
        } finally {
          setLoading(false);
        }
      };

      fetchActivity();
    } else if (!id && !data) {
      // No ID and no Local State -> Redirect
      navigate("/", { replace: true });
    }
  }, [id, data, navigate, user, authLoading]);

  useEffect(() => {
    if (!metadata?.id || !user) {
      setSegmentRanks([]);
      return;
    }

    let cancelled = false;
    fetchActivitySegmentRanks(metadata.id)
      .then((ranks) => {
        if (!cancelled) setSegmentRanks(ranks);
      })
      .catch((error) => {
        console.warn("Could not load this activity's segment ranks", error);
        if (!cancelled) setSegmentRanks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [metadata?.id, user]);

  // Calculate effective speed cap for display
  const effectiveSpeedCap = !isOwner && metadata?.public && metadata?.speed_cap
    ? metadata.speed_cap
    : null;

  const getResolvedTheme = (): "light" | "dark" => {
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  };

  const handleShareImageDownload = async (format: "route" | "map") => {
    if (!data || !isOwner || isSharing) return;

    try {
      setIsSharing(true);
      const file = format === "route"
        ? await createTransparentRouteShareImage({
          title: data.fileName,
          points: data.points,
          stats: data.stats,
          hideRadius: metadata?.hide_radius,
        })
        : await createMapShareImage({
          title: data.fileName,
          points: data.points,
          stats: data.stats,
          hideRadius: metadata?.hide_radius,
          theme: getResolvedTheme(),
        });
      downloadImageFile(file);
      toast.success(format === "route" ? "Transparent route PNG downloaded." : "Map image downloaded.");
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        console.error("Failed to share activity image:", err);
        toast.error("Could not create the image.");
      }
    } finally {
      setIsSharing(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Show access denied page instead of redirecting
  if (accessDenied || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 text-center px-4">
        <Lock className="w-12 h-12 text-muted-foreground" />
        <h1 className="text-xl font-bold">Unable to Load Activity</h1>
        <p className="text-muted-foreground text-sm max-w-md">
          {errorDetails || "This activity looks private or doesn't exist."}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()} variant="outline">
            Retry
          </Button>
          <Button onClick={() => navigate("/")} variant="default">
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  // Description truncation
  const description = metadata?.description || "";
  const isLongDescription = description.length > 200;
  const displayDescription = showFullDescription
    ? description
    : description.slice(0, 200);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-[1001]">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => navigate('/dashboard')}>
              <span className="font-bold text-xl text-foreground hidden md:block">DrivenStat</span>
            </div>
            {user && (
              <>
                <div className="h-6 w-px bg-border hidden md:block" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // 1. Try explicit state from navigation
                    const stateFrom = location.state?.from;
                    if (typeof stateFrom === 'string') {
                      navigate(stateFrom, { replace: true });
                      return;
                    }

                    // 2. Try session backup (handles refreshes)
                    const savedPath = sessionStorage.getItem('lastListPath');
                    if (savedPath) {
                      navigate(savedPath, { replace: true });
                      return;
                    }

                    // 3. Fallback
                    navigate(-1);
                  }}
                  className="gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </>
            )}
            {/* Removed second DrivenStat */}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2 max-w-full">
                <span className="font-bold text-lg text-foreground truncate max-w-[200px] md:max-w-xs lg:max-w-none" title={data.fileName}>{data.fileName}</span>
                {metadata && (
                  metadata.public ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30 shrink-0">
                      <Globe className="w-3 h-3" />
                      <span className="hidden sm:inline">Public</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border shrink-0">
                      <Lock className="w-3 h-3" />
                      <span className="hidden sm:inline">Private</span>
                    </span>
                  )
                )}
              </div>
            </div>
            {isOwner && metadata && (
              <>
                {metadata.public && data && (
                  <SegmentCreator
                    activityId={metadata.id}
                    activityTitle={metadata.title}
                    points={data.points}
                    hideRadius={metadata.hide_radius ?? 0}
                    stopPoints={data.stats.stopPoints}
                    tightTurnPoints={data.stats.tightTurnPoints}
                    hairpinPoints={data.stats.hairpinPoints}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsEditorOpen(true)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <ActivityEditor
                  open={isEditorOpen}
                  onOpenChange={setIsEditorOpen}
                  activity={{
                    id: metadata.id,
                    title: metadata.title,
                    description: metadata.description,
                    public: metadata.public,
                    speed_cap: metadata.speed_cap,
                    hide_radius: metadata.hide_radius,
                    file_path: metadata.file_path,
                    fuel: metadata.fuel
                  }}
                  onUpdate={(updated) => setMetadata({ ...metadata, ...updated })}
                />
              </>
            )}

            {isOwner && data && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={isSharing}
                      title="Download Share Image"
                    >
                      {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>Download share image</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => handleShareImageDownload("route")}>
                      Transparent route PNG
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleShareImageDownload("map")}>
                      Full map PNG ({getResolvedTheme()})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsVideoOpen(true)}
                  title="Generate Video"
                >
                  <Film className="w-4 h-4" />
                </Button>
                <VideoGenerator
                  open={isVideoOpen}
                  onOpenChange={setIsVideoOpen}
                  points={data.points}
                  title={data.fileName}
                />
              </>
            )}

            {user && <HeaderProfile />}

            {/* Header Login Button for Anonymous Users */}
            {!user && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 ml-2"
                onClick={() => signInWithGoogle()}
              >
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Sign in with Google</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Experience Warning */}
      {isMobile && (
        <div className="w-full bg-red-500/10 border-b border-red-500/20 px-4 py-2.5 text-center animate-in slide-in-from-top-5">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            For the best experience and full features, please use DrivenStat on a laptop or desktop.
          </p>
        </div>
      )}
      {/* Main Content */}
      <main className={`container mx-auto px-4 py-6 space-y-8 ${!user ? 'pb-32 md:pb-28' : ''}`}>
        <div className="max-w-[1600px] mx-auto">
          <GPSStats
            stats={data.stats}
            fileName={data.fileName}
            points={data.points}
            speedCap={effectiveSpeedCap}
            displaySpeedCap={metadata?.speed_cap}
            isOwner={isOwner}
            isPublic={metadata?.public || false}
            description={metadata?.description || null}
            hideRadius={metadata?.hide_radius ?? 5}
            fuel={metadata?.fuel ?? null}
            ownerProfile={ownerProfile}
            onEdit={() => setIsEditorOpen(true)}
            segmentRanks={segmentRanks}
          />
        </div>
      </main>



      {/* Fixed Bottom Banner for Anonymous Users */}
      {!user && (
        <div className="fixed bottom-0 left-0 right-0 z-[1002] border-t border-primary/20 bg-background/95 backdrop-blur-md shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-full duration-700 delay-500">
          <div className="container mx-auto px-3 py-3 md:py-4 flex flex-col md:flex-row items-center justify-between gap-2 max-w-5xl">
            <div className="text-center md:text-left space-y-1">
              <h3 className="font-bold text-base md:text-lg flex items-center justify-center md:justify-start gap-2">
                <Globe className="w-4 h-4 text-primary" />
                Unlock the Full Experience
              </h3>
              <p className="text-sm text-muted-foreground max-w-xl">
                Sign in for free to view other public drives, save your own activities, and access advanced analysis tools.
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

export default Activity;
