import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Pencil, ChevronDown, ChevronUp, Globe, Lock, LogIn } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import GPSStats from "@/components/GPSStats";
import { GPXStats, GPXPoint, parseGPX, calculateStats, ProcessedTrack, generateProcessedTrack } from "@/utils/gpxParser";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import ActivityEditor from "@/components/ActivityEditor";

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
  file_path?: string;
}

interface OwnerProfile {
  display_name: string | null;
  avatar_url: string | null;
  car: string | null;
}

const ActivityPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();

  // Initialize state from location state (if uploaded locally) or null
  const [data, setData] = useState<ActivityState | null>(
    (location.state as ActivityState) || null
  );
  const [metadata, setMetadata] = useState<ActivityMetadata | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

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
            file_path: record.file_path
          });

          // 1.5 Fetch owner profile
          const { data: profileData } = await supabase
            .from('profiles')
            .select('display_name, avatar_url, car')
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

          let points: GPXPoint[] = [];
          let stats: GPXStats;
          let previewCoordinates: [number, number][];

          // 2. Try to download pre-processed JSON first
          // Robust naming convention
          const processedPath = record.file_path.replace(/\.gpx$/i, '') + '.processed.json';
          const { data: processedData, error: processedError } = await supabase.storage
            .from('gpx-files')
            .download(processedPath);

          if (!processedError && processedData) {
            // HIT: Use cached data
            const text = await processedData.text();
            const processedTrack = JSON.parse(text) as ProcessedTrack;

            // Map back to GPXPoint structure for components that need it
            points = processedTrack.points.map(p => ({
              lat: p.lat,
              lon: p.lon,
              ele: p.ele,
              time: p.time ? new Date(p.time) : undefined,
            }));

            // Use pre-computed stats
            stats = processedTrack.stats;
          } else {
            // MISS: Fallback to raw GPX
            const { data: fileData, error: storageError } = await supabase.storage
              .from('gpx-files')
              .download(record.file_path);

            if (storageError) {
              console.error("Storage Error:", storageError);
              setErrorDetails(`Storage Error: ${storageError.message}`);
              setAccessDenied(true);
              setLoading(false);
              return;
            }

            // 3. Parse Raw GPX & Lazily Cache
            const text = await fileData.text();
            points = parseGPX(text);

            // LAZY GENERATION: Create full processed track now
            const processedTrack = generateProcessedTrack(points);
            stats = processedTrack.stats;

            // Fire-and-forget upload to cache for next time
            // Use robust naming convention
            const cachePath = record.file_path.replace(/\.gpx$/i, '') + '.processed.json';
            supabase.storage
              .from('gpx-files')
              .upload(cachePath, new Blob([JSON.stringify(processedTrack)], { type: 'application/json' }))
              .then(({ error }) => {
                if (error) console.warn("Background cache upload failed:", error);
                else console.log("Lazily cached processed track:", cachePath);
              });
          }

          setData({
            stats,
            points,
            fileName: record.title
          });

        } catch (err: any) {
          console.error("Error loading activity:", err);
          setErrorDetails(err.message || "Unknown error occurred");
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

  // Calculate effective speed cap for display
  const effectiveSpeedCap = !isOwner && metadata?.public && metadata?.speed_cap
    ? metadata.speed_cap
    : null;

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
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(id ? "/dashboard" : "/")}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              {id ? "Dashboard" : "Back"}
            </Button>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Logo className="w-10 h-10 shadow-lg shadow-primary/20" />
              <span className="font-bold text-xl text-foreground">DrivenStat</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end max-w-[50%] md:max-w-none">
              <div className="flex items-center gap-2 max-w-full">
                <span className="font-bold text-lg text-foreground truncate max-w-[150px] md:max-w-xs lg:max-w-none" title={data.fileName}>{data.fileName}</span>
                {metadata && (
                  metadata.public ? (
                    <Globe className="w-4 h-4 text-green-500 shrink-0" />
                  ) : (
                    <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
                  )
                )}
              </div>
              <span className="text-xs text-muted-foreground hidden sm:inline">Activity Details</span>
            </div>
            {isOwner && metadata && (
              <>
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
                    file_path: metadata.file_path
                  }}
                  onUpdate={(updated) => setMetadata({ ...metadata, ...updated })}
                />
              </>
            )}

            {/* Header Login Button for Anonymous Users */}
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
      {/* Main Content */}
      <main className="container mx-auto px-4 py-4 space-y-6">
        <div className="max-w-[1600px] mx-auto">
          <GPSStats
            stats={data.stats}
            fileName={data.fileName}
            points={data.points}
            speedCap={effectiveSpeedCap}
            isOwner={isOwner}
            isPublic={metadata?.public || false}
            description={metadata?.description || null}
            hideRadius={metadata?.hide_radius ?? 5}
            ownerProfile={ownerProfile}
            onEdit={() => setIsEditorOpen(true)}
          />
        </div>
      </main>



      {/* Fixed Bottom Banner for Anonymous Users */}
      {!user && (
        <div className="fixed bottom-0 left-0 right-0 z-[1002] border-t border-primary/20 bg-background/95 backdrop-blur-md shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-full duration-700 delay-500">
          <div className="container mx-auto px-4 py-4 md:py-6 flex flex-col md:flex-row items-center justify-between gap-4 max-w-5xl">
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

export default ActivityPage;
