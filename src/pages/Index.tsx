import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Route, Clock, Zap, LogIn, LayoutDashboard } from "lucide-react";
import FileUploader from "@/components/FileUploader";
import { parseGPX, calculateStats } from "@/utils/gpxParser";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFilesLoad = (files: { content: string; name: string }[]) => {
    if (files.length === 0) return;
    const { content, name } = files[0];
    setIsLoading(true);
    setError(null);

    try {
      const parsedPoints = parseGPX(content);

      if (parsedPoints.length === 0) {
        setError("No GPS points found in the file. Please check your GPX file.");
        setIsLoading(false);
        return;
      }

      const calculatedStats = calculateStats(parsedPoints);

      // Navigate to activity page with data
      navigate("/activity", {
        state: {
          stats: calculatedStats,
          points: parsedPoints,
          fileName: name,
        },
      });
    } catch (err) {
      setError("Failed to parse GPX file. Please make sure it's a valid GPX format.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <MapPin className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl text-foreground">GPS Analyzer</span>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate("/dashboard")}
                className="gap-2"
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/login")}
                className="gap-2"
              >
                <LogIn className="w-4 h-4" />
                Log In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden flex-1">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10 pointer-events-none" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-accent/20 rounded-full blur-3xl pointer-events-none" />

        <div className="container mx-auto px-4 py-16 md:py-24 relative">
          <div className="max-w-3xl mx-auto text-center space-y-6 mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              <Route className="w-4 h-4" />
              Free GPS Track Analysis
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
              Analyze Your{" "}
              <span className="text-primary">GPS Tracks</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Upload your GPX files and instantly get detailed insights about your
              routes — distance, speed, time, elevation, and interactive maps.
            </p>

            <div className="flex flex-col items-center gap-4 mt-8">
              {!user && (
                <Button
                  size="lg"
                  onClick={() => navigate("/login")}
                  className="gap-2 text-lg h-12 px-8 shadow-lg shadow-primary/20"
                >
                  <LogIn className="w-5 h-5" />
                  Sign In to Start
                </Button>
              )}
            </div>
          </div>

          {/* Upload Section */}
          <div className="max-w-2xl mx-auto">
            <div className="bg-card border border-border rounded-2xl p-2 shadow-xl shadow-primary/5">
              <FileUploader onFilesLoad={handleFilesLoad} isLoading={isLoading} />

              {/* Error Message */}
              {error && (
                <div className="max-w-2xl mx-auto mt-6">
                  <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
                    <p className="text-destructive font-medium">{error}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-12 md:py-16 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">
            What You'll Get
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Route,
                title: "Distance",
                description: "Accurate total distance from GPS coordinates",
              },
              {
                icon: Clock,
                title: "Time",
                description: "Total duration and moving time analysis",
              },
              {
                icon: Zap,
                title: "Speed",
                description: "Average and maximum speed with timeline chart",
              },
              {
                icon: MapPin,
                title: "Route Map",
                description: "Interactive map with your complete track",
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="text-center p-6 rounded-2xl bg-card border border-border hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Apps */}
      <section className="container mx-auto px-4 py-12 md:py-16 bg-card/50">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-muted-foreground mb-4">Works with GPX files from</p>
          <div className="flex flex-wrap justify-center gap-4 text-sm font-medium text-foreground">
            {["Strava", "Garmin", "Komoot", "AllTrails", "Apple Watch", "Google Maps"].map((app) => (
              <span
                key={app}
                className="px-4 py-2 rounded-full bg-background border border-border"
              >
                {app}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>Upload your GPX files securely — all processing happens in your browser.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
