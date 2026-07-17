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
                        <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">About Us</p>
                        <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
                            Our Story
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
                            DrivenStat was started by me, Aditya Raskar and Ritul Sherkar.
                        </p>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
                            I love driving, and I wanted a better way to store and understand my drives. Most tools could show me a route, distance, or average speed, but I wanted more detail. I wanted to know what actually happened during a drive: how much time I spent at different speeds, how long different sections of the road took, where I slowed down, where I gained pace, how elevation changed, and how one part of a route compared with another.
                        </p>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
                            DrivenStat began as a passion project for that reason. It was first built for my own drives, then slowly grew into something we thought other driving enthusiasts might find useful too.
                        </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <h3 className="font-bold text-xl">Why We Built It</h3>
                        <p className="text-muted-foreground leading-relaxed">
                            A GPX file has a lot of useful information inside it, but most of that detail is hard to read without the right tools. DrivenStat is our attempt to make that data easier to explore.
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                            Upload a drive, see the route, inspect the timeline, compare speed and elevation, understand different sections of the road, and keep a record of drives that matter to you.
                        </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <h3 className="font-bold text-xl">Where We Want To Take It</h3>
                        <p className="text-muted-foreground leading-relaxed">
                            We want DrivenStat to grow into a social network for driving enthusiasts, but with strong privacy at the center.
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                            You should be able to keep your drives completely private if that is what you want. You should only share a drive when you choose to. Public sharing should feel intentional, not forced.
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                            Over time, we want DrivenStat to become a place where people can store their own drives, analyze them deeply, discover interesting public drives, and learn from how different routes are driven.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
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
                </section>
            </main>

            <footer className="border-t border-border bg-card/50">
                <nav
                    aria-label="Legal"
                    className="container mx-auto max-w-4xl px-4 py-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
                >
                    <button
                        type="button"
                        onClick={() => navigate('/terms')}
                        className="transition-colors hover:text-foreground hover:underline"
                    >
                        Terms of Service
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/privacy')}
                        className="transition-colors hover:text-foreground hover:underline"
                    >
                        Privacy Policy
                    </button>
                </nav>
            </footer>

            <div className="fixed bottom-6 left-6 z-[1050]">
                <ThemeToggle />
            </div>
        </div>
    );
};

export default About;
