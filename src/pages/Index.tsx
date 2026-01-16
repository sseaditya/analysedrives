import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Route, Clock, Zap, LogIn, LayoutDashboard, Gauge as Speedometer, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;
    } catch (err) {
      console.error("Error signing in:", err);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <MapPin className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-serif font-bold text-xl text-foreground tracking-tight">AnalyseDrive</span>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate("/dashboard")}
                className="gap-2 rounded-full font-medium"
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Button>
            ) : (
              // Direct Google Sign In Button
              <Button
                variant="outline"
                size="sm"
                onClick={handleGoogleSignIn}
                className="gap-2 rounded-full border-border/60 hover:bg-muted/50"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section - Cooler & Darker Vibe */}
      <section className="relative overflow-hidden flex-1 flex flex-col items-center justify-center min-h-[80vh]">
        {/* Abstract Background Elements */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/20 via-background to-background pointer-events-none" />
        <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[600px] h-[600px] bg-accent/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="container mx-auto px-4 relative z-10 text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-muted/30 border border-border/50 text-muted-foreground text-sm font-medium backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span>Advanced GPS Telemetry</span>
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-serif font-bold text-foreground leading-[1.1] tracking-tight animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            Master Your <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-destructive">Performance.</span>
          </h1>

          <p className="text-lg md:text-2xl text-muted-foreground max-w-2xl mx-auto font-light leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
            Professional-grade analysis for your drives, rides, and runs.
            Visualize speed, elevation, and motion with precision.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8 animate-in fade-in slide-in-from-bottom-10 duration-700 delay-300">
            {!user && (
              <Button
                size="lg"
                onClick={handleGoogleSignIn}
                className="h-14 px-8 text-lg rounded-full shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-all hover:scale-105"
              >
                <LogIn className="w-5 h-5 mr-2" />
                Start analyzing with Google
              </Button>
            )}
          </div>
        </div>

        {/* Placeholder UI Preview */}
        <div className="container mx-auto px-4 mt-20 relative z-10 animate-in fade-in zoom-in-95 duration-1000 delay-500">
          <div className="rounded-xl overflow-hidden border border-border/50 shadow-2xl bg-card/50 backdrop-blur-sm mx-auto max-w-5xl aspect-[16/9] flex items-center justify-center relative group">
            {/* Fallback pattern if no image */}
            <div className="absolute inset-0 bg-gradient-to-br from-muted/10 to-transparent" />
            <div className="text-center p-8">
              <LayoutDashboard className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-muted-foreground/50 text-sm tracking-widest uppercase font-semibold">Interactive Dashboard Preview</p>
              {/* Note: Provide actual screenshot here if available later */}
            </div>

            {/* Decorative overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      {/* Features Showcase */}
      <section className="container mx-auto px-4 py-24 border-t border-border/40">
        <h2 className="text-3xl md:text-4xl font-serif font-bold text-center text-foreground mb-16">
          Precision Tools
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {[
            {
              icon: Speedometer,
              title: "Speed Distribution",
              description: "Analyze how much time you spent at specific speed zones.",
              color: "text-blue-500"
            },
            {
              icon: Route,
              title: "Interactive Maps",
              description: "Full-resolution track mapping with theme-aware tiles.",
              color: "text-amber-500"
            },
            {
              icon: Activity,
              title: "Motion Profile",
              description: "Deep dive into acceleration and braking patterns.",
              color: "text-red-500"
            },
          ].map((feature, index) => (
            <div key={index} className="group p-8 rounded-3xl bg-card hover:bg-muted/30 transition-colors border border-border/50">
              <feature.icon className={`w-8 h-8 ${feature.color} mb-6`} />
              <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-background py-12">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} AnalyseDrive. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <a href="#" className="hover:text-foreground transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
