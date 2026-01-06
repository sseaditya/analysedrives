import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Pencil, ChevronDown, ChevronUp, Globe, Lock } from "lucide-react";
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
}

const ActivityPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // Initialize state from location state (if uploaded locally) or null
  const [data, setData] = useState<ActivityState | null>(
    (location.state as ActivityState) || null
  );
  const [metadata, setMetadata] = useState<ActivityMetadata | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

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
            // If error is "no rows returned" or permission denied, show access denied
            console.error("DB Error:", dbError);
            if (dbError.code === 'PGRST116' || dbError.code === '42501') {
              setAccessDenied(true);
              setLoading(false);
              return;
            }
            throw dbError;
          }

          // Check access: if not public and not owner, show access denied
          if (!record.public && (!user || user.id !== record.user_id)) {
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
          });

          // 2. Download File
          const { data: fileData, error: storageError } = await supabase.storage
            .from('gpx-files')
            .download(record.file_path);

          if (storageError) {
            console.error("Storage Error:", storageError);
            throw storageError;
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

        } catch (err) {
          console.error("Error loading activity:", err);
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <Lock className="w-12 h-12 text-muted-foreground" />
        <h1 className="text-xl font-bold">Activity Not Found</h1>
        <p className="text-muted-foreground text-sm">This activity doesn't exist or is private.</p>
        <Button onClick={() => navigate("/")} variant="outline">
          Go Home
        </Button>
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
                }}
                onUpdate={(updated) => setMetadata({ ...metadata, ...updated })}
              >
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Pencil className="w-4 h-4" />
                </Button>
              </ActivityEditor>
            )}
          </div>
        </div>
      </header>

      {/* Description Section (if exists) */}
      {description && (
        <div className="container mx-auto px-4 py-4 border-b border-border">
          <div className="max-w-[1600px] mx-auto">
            <p className="text-sm text-muted-foreground">
              {displayDescription}
              {isLongDescription && !showFullDescription && "..."}
            </p>
            {isLongDescription && (
              <button
                onClick={() => setShowFullDescription(!showFullDescription)}
                className="mt-2 text-xs font-medium text-primary hover:underline flex items-center gap-1"
              >
                {showFullDescription ? (
                  <>Show less <ChevronUp className="w-3 h-3" /></>
                ) : (
                  <>Show more <ChevronDown className="w-3 h-3" /></>
                )}
              </button>
            )}
          </div>
        </div>
      )}

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
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 mt-auto">
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
    </div>
  );
};

export default ActivityPage;
