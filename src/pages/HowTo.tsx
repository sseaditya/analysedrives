import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, ChevronDown, ChevronUp, Monitor, Smartphone, Shield, Eye, EyeOff, Gauge } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";

const HowTo = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [showAdvanced, setShowAdvanced] = useState(false);

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                    {user && (
                        <>
                            <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => navigate('/dashboard')}>
                                <span className="font-bold text-xl text-foreground hidden md:block">DrivenStat</span>
                            </div>
                            <div className="h-6 w-px bg-border hidden md:block" />
                            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                            <div className="h-6 w-px bg-border hidden md:block" />
                        </>
                    )}
                    <h1 className="text-lg font-bold">How to Get Your Drive Data</h1>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 max-w-3xl space-y-10">

                {/* Intro */}
                <div className="bg-card border border-border rounded-xl p-6">
                    <p className="text-sm text-foreground">
                        DrivenStat works with <span className="font-bold">GPX files</span>, a standard GPS format supported by many apps.
                        The easiest way to get started is with <span className="font-bold">Strava</span> (free).
                    </p>
                </div>

                {/* Step 1: Record with Strava */}
                <section className="space-y-4">
                    <div className="flex items-center gap-3">
                        <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                        <h2 className="text-2xl font-bold">Record Your Drive</h2>
                    </div>
                    <h3 className="text-base font-semibold text-muted-foreground">Record with Strava</h3>
                    <p className="text-sm text-muted-foreground">
                        Use the free Strava app on your phone to record your drive. Start recording before you begin driving, and stop when you're done.
                    </p>
                    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                        <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                            <li className="pl-2">Download <span className="font-bold">Strava</span> from the App Store or Google Play.</li>
                            <li className="pl-2">Open the app, tap the <span className="font-bold">+ Record</span> button.</li>
                            <li className="pl-2">Select the activity type - <span className="font-bold">Ride.</span></li>
                            <li className="pl-2">Tap <span className="font-bold">Start</span> and begin your drive.</li>
                            <li className="pl-2">When done, tap <span className="font-bold">Stop → Finish</span> to save.</li>
                            <li className="pl-2">You can <span className="font-bold">pause and restart</span> when taking discretionary stops (fuel, food, etc.) — just remember to restart!</li>
                            <li className="pl-2">Do <span className="font-bold">not</span> use Strava's auto start/stop feature.</li>
                        </ol>
                        <a
                            href="https://support.strava.com/hc/en-us/articles/216918167-Recording-an-Activity-with-the-Strava-App"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-medium mt-2"
                        >
                            <Smartphone className="w-4 h-4" />
                            Strava's official recording guide
                            <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>
                </section>

                {/* Step 2: Export GPX */}
                <section className="space-y-4">
                    <div className="flex items-center gap-3">
                        <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                        <h2 className="text-2xl font-bold">Export Your GPX File</h2>
                    </div>
                    <h3 className="text-base font-semibold text-muted-foreground">Export from Strava</h3>

                    <div className="bg-card border border-border rounded-xl p-6 flex items-start gap-3">
                        <Monitor className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <p className="text-sm text-muted-foreground">
                            <span className="font-bold text-foreground">Desktop only</span> — GPX export is only available on the Strava website, not the mobile app.
                        </p>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                        <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                            <li className="pl-2">Go to your activity page on <a href="https://www.strava.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">strava.com</a> (on desktop).</li>
                            <li className="pl-2">Click the <span className="font-bold">three dots (...)</span> icon on the left sidebar.</li>
                            <li className="pl-2">Select <span className="font-bold">Export GPX</span>.</li>
                            <li className="pl-2">Upload the downloaded file here.</li>
                        </ol>
                    </div>
                </section>

                {/* Step 3: Upload */}
                <section className="space-y-4">
                    <div className="flex items-center gap-3">
                        <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">3</span>
                        <h2 className="text-2xl font-bold">Upload to DrivenStat</h2>
                    </div>
                    <div className="flex justify-center">
                        <Button size="lg" onClick={() => navigate('/dashboard')}>
                            Go to Dashboard & Upload
                        </Button>
                    </div>
                </section>

                {/* Privacy: Who Can See What */}
                <section className="border-t border-border pt-8 space-y-4">
                    <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-primary" />
                        <h2 className="text-xl font-bold">Who Can See What?</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Your privacy is important. Here's how DrivenStat protects your data:
                    </p>
                    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
                        <div className="flex items-start gap-3">
                            <EyeOff className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                            <div>
                                <p className="text-sm font-bold text-foreground">Drives are private by default</p>
                                <p className="text-sm text-muted-foreground">Other people can only see your drives after you explicitly make them public.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <Eye className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                            <div>
                                <p className="text-sm font-bold text-foreground">Start & end zones are hidden</p>
                                <p className="text-sm text-muted-foreground">The first and last few kilometers (you can choose the radius) are clipped from the map, so your start/stop location stays private.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <Gauge className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                            <div>
                                <p className="text-sm font-bold text-foreground">Speed cap</p>
                                <p className="text-sm text-muted-foreground">You can set a speed cap on your drive. Viewers will only see the capped speed value for any section that exceeds it.</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Advanced: Garmin */}
                <section className="border-t border-border pt-8">
                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                    >
                        {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        Advanced: Other GPS Sources
                    </button>

                    {showAdvanced && (
                        <div className="mt-6 space-y-4 animate-in slide-in-from-top-2">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold">
                                    G
                                </div>
                                <h3 className="text-xl font-bold">Garmin Connect</h3>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-6 flex items-start gap-3">
                                <Monitor className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                                <p className="text-sm text-muted-foreground">
                                    <span className="font-bold text-foreground">Desktop only</span> — GPX export is only available on the Garmin Connect website.
                                </p>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                                <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                                    <li className="pl-2">Open the activity in <a href="https://connect.garmin.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Garmin Connect Web</a>.</li>
                                    <li className="pl-2">Click the <span className="font-bold">Gear icon</span> in the top right.</li>
                                    <li className="pl-2">Select <span className="font-bold">Export to GPX</span>.</li>
                                </ol>
                            </div>

                            <div className="bg-card border border-border rounded-xl p-6">
                                <p className="text-sm text-muted-foreground">
                                    <span className="font-bold text-foreground">Any app that exports GPX files will work.</span>{" "}
                                    If your GPS device or app can save to the .gpx format, you can upload it to DrivenStat.
                                </p>
                            </div>
                        </div>
                    )}
                </section>

            </main>

            {/* Floating Theme Toggle */}
            <div className="fixed bottom-6 left-6 z-[1050]">
                <ThemeToggle />
            </div>
        </div>
    );
};

export default HowTo;
