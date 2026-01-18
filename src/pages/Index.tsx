import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Route, Clock, Zap, LogIn, LayoutDashboard, Gauge as Speedometer, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

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
    <div className="min-h-screen bg-[#FAFAF7] text-[#191919] flex flex-col font-sans">
      {/* Header - Minimalist */}
      <header className="absolute top-0 left-0 right-0 z-50 p-6 flex justify-between items-center bg-transparent">
        <div className="flex items-center gap-2">
          <span className="font-bold text-2xl tracking-tight text-[#CC785C]">ANALYSEDRIVE</span>
        </div>
        <div>
          {!user ? (
            <button
              onClick={handleGoogleSignIn}
              className="bg-white text-[#191919] hover:bg-gray-50 border border-gray-200 px-5 py-2 rounded-full text-sm font-semibold transition-all shadow-sm"
            >
              Log In
            </button>
          ) : (
            <button
              onClick={() => navigate('/dashboard')}
              className="bg-[#CC785C] text-white hover:bg-[#b06a50] px-5 py-2 rounded-full text-sm font-bold transition-all shadow-sm"
            >
              Dashboard
            </button>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col lg:flex-row items-center relative overflow-hidden pt-20 lg:pt-0">

        {/* Left Image - Hidden on mobile, visible on lg */}
        <div className="hidden lg:block w-1/4 h-screen relative">
          <img
            src="/landing_left.png"
            alt="Cyclists"
            className="w-full h-full object-cover opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#FAFAF7]/40 mix-blend-multiply"></div>
        </div>

        {/* Center Content */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 z-10 max-w-2xl mx-auto py-12 lg:py-0">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
            The #1 app for <br />
            <span className="text-[#CC785C]">precision telemetry.</span>
          </h1>

          <p className="text-xl text-[#666663] mb-10 max-w-lg mx-auto font-medium leading-relaxed">
            Track your drives, analyze your cornering, and master your speed with professional-grade GPS tools.
          </p>

          <div className="flex flex-col items-center gap-4 w-full max-w-xs mx-auto">
            {!user && (
              <>
                <button
                  onClick={handleGoogleSignIn}
                  className="w-full bg-[#CC785C] hover:bg-[#b06a50] text-white h-14 rounded-md font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-3"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#FFFFFF" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#FFFFFF" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FFFFFF" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#FFFFFF" /></svg>
                  Sign In with Google
                </button>
                <div className="text-xs text-[#666663] mt-4">
                  By signing up, you agree to our <a href="/terms" className="underline hover:text-[#191919]">Terms</a> and <a href="/privacy" className="underline hover:text-[#191919]">Privacy Policy</a>.
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Image - Hidden on mobile, visible on lg */}
        <div className="hidden lg:block w-1/4 h-screen relative">
          <img
            src="/landing_right.png"
            alt="Runner"
            className="w-full h-full object-cover opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-l from-transparent to-[#FAFAF7]/40 mix-blend-multiply"></div>
        </div>

      </main>

      {/* Footer Features - Precision Tool */}
      <section className="bg-white py-16 px-4 border-t border-[#E5E4DF]">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[#666663] mb-12">Precision Tools for Enthusiasts</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-xl border border-[#E5E4DF] hover:border-[#CC785C]/50 transition-colors bg-[#FAFAF7]">
              <Speedometer className="w-8 h-8 text-[#CC785C] mx-auto mb-4" />
              <h3 className="font-bold text-[#191919] mb-2">Distribution Analysis</h3>
              <p className="text-sm text-[#666663] leading-relaxed">Visualize exactly how much time you spend in specific speed zones and gradients.</p>
            </div>
            <div className="p-6 rounded-xl border border-[#E5E4DF] hover:border-[#CC785C]/50 transition-colors bg-[#FAFAF7]">
              <Zap className="w-8 h-8 text-[#CC785C] mx-auto mb-4" />
              <h3 className="font-bold text-[#191919] mb-2">Motion Profiling</h3>
              <p className="text-sm text-[#666663] leading-relaxed">Break down your acceleration, braking, and cornering g-forces with millisecond precision.</p>
            </div>
            <div className="p-6 rounded-xl border border-[#E5E4DF] hover:border-[#CC785C]/50 transition-colors bg-[#FAFAF7]">
              <Activity className="w-8 h-8 text-[#CC785C] mx-auto mb-4" />
              <h3 className="font-bold text-[#191919] mb-2">Interactive Timeline</h3>
              <p className="text-sm text-[#666663] leading-relaxed">Zoom into any second of your activity to see correlated speed, elevation, and location data.</p>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};

export default Index;
