import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Compass, Gauge, Share2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const About = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <button
                        onClick={() => navigate('/')}
                        className="font-bold text-xl text-foreground hidden md:block"
                    >
                        DrivenStat
                    </button>
                    <div className="h-6 w-px bg-border hidden md:block" />
                    <h1 className="text-xl font-bold">About Us</h1>
                </div>
            </header>

            <main className="container mx-auto px-4 py-10 max-w-4xl flex-1">
                <section className="space-y-6">
                    <div className="space-y-4">
                        <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">About DrivenStat</p>
                        <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
                            Better context for every drive.
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
                            DrivenStat is a place to upload, analyze, and share drive data. It turns GPX files into maps, charts, and useful driving metrics so enthusiasts can understand each route with more precision.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                        <div className="rounded-xl border border-border bg-card p-5">
                            <Gauge className="w-6 h-6 text-primary mb-4" />
                            <h3 className="font-bold mb-2">Analyze</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Review speed, elevation, timing, and route details from each uploaded drive.
                            </p>
                        </div>
                        <div className="rounded-xl border border-border bg-card p-5">
                            <Compass className="w-6 h-6 text-primary mb-4" />
                            <h3 className="font-bold mb-2">Explore</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Browse public community drives and discover how different routes compare.
                            </p>
                        </div>
                        <div className="rounded-xl border border-border bg-card p-5">
                            <Share2 className="w-6 h-6 text-primary mb-4" />
                            <h3 className="font-bold mb-2">Share</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Publish selected activities while keeping private drives under your control.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-6">
                        <h3 className="font-bold text-xl mb-3">Our Goal</h3>
                        <p className="text-muted-foreground leading-relaxed">
                            We are building simple, focused tools for people who care about the details of a drive. This page is placeholder copy for now and can be updated with the final story, team details, and contact information later.
                        </p>
                    </div>
                </section>
            </main>

            <div className="fixed bottom-6 left-6 z-[1050]">
                <ThemeToggle />
            </div>
        </div>
    );
};

export default About;
