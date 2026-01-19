import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, FileJson, Globe } from "lucide-react";

const HowTo = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <h1 className="text-xl font-bold">How to Export Your Data</h1>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8 max-w-3xl space-y-12">

                <section className="space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#FC4C02] text-white flex items-center justify-center font-bold">
                            S
                        </div>
                        <h2 className="text-2xl font-bold">Strava</h2>
                    </div>
                    <p className="text-muted-foreground">
                        The easiest way to get your data into DrivenStat is by exporting your original GPX files from Strava.
                    </p>
                    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                        <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                            <li className="pl-2">Go to the activity page on Strava.com (Desktop).</li>
                            <li className="pl-2">Click the <span className="font-bold">three dots (...)</span> icon on the left sidebar.</li>
                            <li className="pl-2">Select <span className="font-bold">Export GPX</span>.</li>
                            <li className="pl-2">Upload the downloaded file here.</li>
                        </ol>
                    </div>
                </section>

                <section className="space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold">
                            G
                        </div>
                        <h2 className="text-2xl font-bold">Garmin Connect</h2>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                        <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                            <li className="pl-2">Open the activity in Garmin Connect Web.</li>
                            <li className="pl-2">Click the <span className="font-bold">Gear icon</span> in the top right.</li>
                            <li className="pl-2">Select <span className="font-bold">Export to GPX</span>.</li>
                        </ol>
                    </div>
                </section>

                <section className="space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-500 text-white flex items-center justify-center font-bold">
                            K
                        </div>
                        <h2 className="text-2xl font-bold">Komoot</h2>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                        <ol className="list-decimal list-inside space-y-3 marker:font-bold marker:text-primary">
                            <li className="pl-2">Open the completed tour.</li>
                            <li className="pl-2">Click the <span className="font-bold">More</span> button.</li>
                            <li className="pl-2">Select <span className="font-bold">Download GPX File</span>.</li>
                        </ol>
                    </div>
                </section>

                <div className="flex justify-center pt-8">
                    <Button size="lg" onClick={() => navigate('/dashboard')}>
                        Back to Dashboard
                    </Button>
                </div>

            </main>
        </div>
    );
};

export default HowTo;
