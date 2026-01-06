import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import GPSStats from "@/components/GPSStats";
import { GPXStats, GPXPoint, parseGPX, calculateStats } from "@/utils/gpxParser";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface ActivityState {
  stats: GPXStats;
  points: GPXPoint[];
  fileName: string;
}

const ActivityPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Initialize state from location state (if uploaded locally) or null
  const [data, setData] = useState<ActivityState | null>(
    (location.state as ActivityState) || null
  );
  const [loading, setLoading] = useState(!!id);

  useEffect(() => {
    // If we have an ID and no data yet, fetch from Supabase
    if (id && !data) {
      const fetchActivity = async () => {
        try {
          setLoading(true);
          // 1. Get Metadata
          const { data: record, error: dbError } = await supabase
            .from('activities')
            .select('*')
            .eq('id', id)
            .single();

          if (dbError) throw dbError;

          // 2. Download File
          const { data: fileData, error: storageError } = await supabase.storage
            .from('gpx-files')
            .download(record.file_path);

          if (storageError) throw storageError;

          // 3. Parse
          const text = await fileData.text();
          const points = parseGPX(text);

          // Always recalculate stats to ensure we use the latest logic from gpxParser
          // This allows us to update algorithms (like stop detection) without re-uploading files
          const stats = calculateStats(points);

          setData({
            stats,
            points,
            fileName: record.title
          });

        } catch (err) {
          console.error("Error loading activity:", err);
          navigate("/"); // Return to home on error
        } finally {
          setLoading(false);
        }
      };

      fetchActivity();
    } else if (!id && !data) {
      // No ID and no Local State -> Redirect
      navigate("/", { replace: true });
    }
  }, [id, data, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!data) return null;

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
          <div className="flex flex-col items-end">
            <span className="font-bold text-lg text-foreground">{data.fileName}</span>
            <span className="text-xs text-muted-foreground">Activity Details</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-[1600px] mx-auto">
          <GPSStats stats={data.stats} fileName={data.fileName} points={data.points} />
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
