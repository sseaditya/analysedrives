import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, ChevronDown, ChevronUp, Monitor, Smartphone } from "lucide-react";

const HowTo = () => {
    const navigate = useNavigate();
    const [showAdvanced, setShowAdvanced] = useState(false);

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <h1 className="text-xl font-bold">How to Get Your Drive Data</h1>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 max-w-3xl space-y-10">

                {/* Intro */}
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
                    <p className="text-sm text-foreground">
                        DrivenStat works with <span className="font-bold">GPX files</span> — a standard GPS format supported by many apps.
                        The easiest way to get started is with <span className="font-bold">Strava</span> (free).
                    </p>
                </div>

                {/* Step 1: Record with Strava */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
                        Record Your Drive
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#FC4C02] text-white flex items-center justify-center font-bold">
                            S
                        </div>
                        <h2 className="text-2xl font-bold">Record with Strava</h2>
                    </div>
                    <p className="text-muted-foreground">
                        Use the free Strava app on your phone to record your drive. Start recording before you begin driving, and stop when you're done.
                    </p>
                    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                        <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                            <li className="pl-2">Download <span className="font-bold">Strava</span> from the App Store or Google Play.</li>
                            <li className="pl-2">Open the app, tap the <span className="font-bold">+ Record</span> button.</li>
                            <li className="pl-2">Select the activity type (e.g. <span className="font-bold">Ride</span> or <span className="font-bold">Walk</span> — any type works).</li>
                            <li className="pl-2">Tap <span className="font-bold">Start</span> and begin your drive.</li>
                            <li className="pl-2">When done, tap <span className="font-bold">Stop → Finish</span> to save.</li>
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
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
                        Export Your GPX File
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#FC4C02] text-white flex items-center justify-center font-bold">
                            S
                        </div>
                        <h2 className="text-2xl font-bold">Export from Strava</h2>
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                        <Monitor className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                            <span className="font-bold">Desktop only</span> — GPX export is only available on the Strava website, not the mobile app.
                        </p>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                        <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                            <li className="pl-2">Go to your activity page on <a href="https://www.strava.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">strava.com</a> (on a computer).</li>
                            <li className="pl-2">Click the <span className="font-bold">three dots (...)</span> icon on the left sidebar.</li>
                            <li className="pl-2">Select <span className="font-bold">Export GPX</span>.</li>
                            <li className="pl-2">Upload the downloaded file here.</li>
                        </ol>
                    </div>
                </section>

                {/* Step 3: Upload */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">3</span>
                        Upload to DrivenStat
                    </div>
                    <div className="flex justify-center">
                        <Button size="lg" onClick={() => navigate('/dashboard')}>
                            Go to Dashboard & Upload
                        </Button>
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
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                                <Monitor className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                                <p className="text-sm text-amber-700 dark:text-amber-400">
                                    <span className="font-bold">Desktop only</span> — GPX export is only available on the Garmin Connect website.
                                </p>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                                <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                                    <li className="pl-2">Open the activity in <a href="https://connect.garmin.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Garmin Connect Web</a>.</li>
                                    <li className="pl-2">Click the <span className="font-bold">Gear icon</span> in the top right.</li>
                                    <li className="pl-2">Select <span className="font-bold">Export to GPX</span>.</li>
                                </ol>
                            </div>

                            <div className="bg-muted/50 border border-border rounded-xl p-5 mt-4">
                                <p className="text-sm text-muted-foreground">
                                    <span className="font-medium text-foreground">Any app that exports GPX files will work.</span>{" "}
                                    If your GPS device or app can save to the .gpx format, you can upload it to DrivenStat.
                                </p>
                            </div>
                        </div>
                    )}
                </section>

            </main>
        </div>
    );
};

export default HowTo;
