import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, ChevronDown, ChevronUp, Monitor, Smartphone, Shield, Eye, EyeOff, Gauge } from "lucide-react";

// Official Strava logo (wordmark) as inline SVG
const StravaLogo = ({ className = "" }: { className?: string }) => (
    <svg viewBox="0 0 632 132" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M131.6 66.2c0-36.5-29.6-66.2-66.1-66.2C29.1 0 0 29.7 0 66.2c0 27.1 16.5 50.5 40 60.5l10.6-22.7c-14.1-6-23.9-20.1-23.9-36.3 0-21.8 17.7-39.5 39.5-39.5s39.5 17.7 39.5 39.5c0 16.2-9.8 30.3-23.9 36.3l10.6 22.7c23.6-10 40.2-33.4 40.2-60.5z" />
        <path d="M291.6 82.3c0 9.3-4.4 15.4-14.3 15.4-9.4 0-14.4-6.6-14.4-15.4V38.5h-27.3v47.4c0 26.5 16.1 41.7 38.2 41.7 13.5 0 21.4-5.9 26.3-13.6v10.8h22.2V38.5h-30.7v43.8zM455.3 38.5h-30.7v43.8c0 9.3-4.4 15.4-14.3 15.4-9.4 0-14.4-6.6-14.4-15.4V38.5h-27.3v47.4c0 26.5 16.1 41.7 38.2 41.7 13.5 0 21.4-5.9 26.3-13.6v10.8h22.2V38.5z" />
        <path d="M339.7 38.5c-8.3 0-16.2 3.3-21.3 10.1V38.5h-27.3v86.3h27.3V80.5c0-9.3 5.5-15.4 13.2-15.4 3.7 0 6.5.9 9.1 2.4l7.8-26.6c-3.1-1.6-6.1-2.4-8.8-2.4z" />
        <path d="M499.7 38.5l-22.4 53.4-22.3-53.4h-29.4l39.8 86.3h23l40.7-86.3z" />
        <path d="M539.3 49.8c5.9-8 14.7-14.1 28-14.1 22.5 0 42.2 18.2 42.2 45.8s-19.7 46.1-42.2 46.1c-13.3 0-22.1-6-28-14.1v11.3h-27.3V0h27.3v49.8zm20.3 51.9c11.6 0 22.1-8.6 22.1-20.2 0-11.6-10.5-20-22.1-20s-21.7 8.4-21.7 20c0 11.6 10.1 20.2 21.7 20.2z" />
        <path d="M218.8 97.7c-11.6 0-22.1-8.6-22.1-20.2 0-11.6 10.5-20 22.1-20s21.7 8.4 21.7 20c0 11.6-10.1 20.2-21.7 20.2zm28-47.9c-5.9-8-14.7-14.1-28-14.1-22.5 0-42.2 18.2-42.2 45.8s19.7 46.1 42.2 46.1c13.3 0 22.1-6 28-14.1v11.3h27.3V38.5h-27.3v11.3z" />
    </svg>
);

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
                        <div className="w-10 h-10 rounded-lg bg-[#FC4C02] text-white flex items-center justify-center p-1.5">
                            <StravaLogo className="w-full h-full" />
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
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
                        Export Your GPX File
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#FC4C02] text-white flex items-center justify-center p-1.5">
                            <StravaLogo className="w-full h-full" />
                        </div>
                        <h2 className="text-2xl font-bold">Export from Strava</h2>
                    </div>

                    <div className="bg-muted/50 border border-border rounded-lg p-3 flex items-start gap-2">
                        <Monitor className="w-4 h-4 text-primary mt-0.5 shrink-0" />
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
                                <p className="text-sm font-bold text-foreground">Speed cap for viewers</p>
                                <p className="text-sm text-muted-foreground">Speeds above your chosen speed cap will not be shown to others, they'll see the capped value instead.</p>
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
                            <div className="bg-muted/50 border border-border rounded-lg p-3 flex items-start gap-2">
                                <Monitor className="w-4 h-4 text-primary mt-0.5 shrink-0" />
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
