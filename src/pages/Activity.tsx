import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Pencil, ChevronDown, ChevronUp, Globe, Lock, LogIn } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import GPSStats from "@/components/GPSStats";
import { GPXStats, GPXPoint, parseGPX, calculateStats } from "@/utils/gpxParser";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
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
          const { data: record, error: dbError } = await supabase
            .from('activities')
            .select('*')
            .eq('id', id)
            .single();

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

          // 2. Download File
          const { data: fileData, error: storageError } = await supabase.storage
            .from('gpx-files')
            .download(record.file_path);

          if (storageError) {
            console.error("Storage Error:", storageError);
            setErrorDetails(`Storage Error: ${storageError.message}`);
            // Don't throw, just handle it
            setAccessDenied(true);
            setLoading(false);
            return;
          }

          // 3. Parse
          const text = await fileData.text();
          const points = parseGPX(text);

          // Always recalculate stats to ensure we use the latest logic from gpxParser
          const stats = calculateStats(points);

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
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                <MapPin className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-xl text-foreground">GPS Analyzer</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-foreground">{data.fileName}</span>
                {metadata && (
                  metadata.public ? (
                    <Globe className="w-4 h-4 text-green-500" />
                  ) : (
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  )
                )}
              </div>
              <span className="text-xs text-muted-foreground">Activity Details</span>
            </div>
            {isOwner && metadata && (
              <ActivityEditor
                activity={{
                  id: metadata.id,
                  description: metadata.description,
                  public: metadata.public,
                  speed_cap: metadata.speed_cap,
                  hide_radius: metadata.hide_radius,
                }}
                onUpdate={(updated) => setMetadata({ ...metadata, ...updated })}
              >
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Pencil className="w-4 h-4" />
                </Button>
              </ActivityEditor>
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
      <main className="container mx-auto px-4 py-8 md:py-12">
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
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 mt-auto mb-20 md:mb-0">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="gap-2"
          >
            Analyze Another Track
          </Button>
        </div>
      </footer>

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
