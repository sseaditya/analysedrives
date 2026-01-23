import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const Privacy = () => {
    const navigate = useNavigate();
    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <h1 className="text-xl font-bold">Privacy Policy</h1>
                </div>
            </header>
            <main className="container mx-auto px-4 py-8 max-w-3xl space-y-8 text-foreground/90">
                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">1. Introduction</h2>
                    <p className="leading-relaxed">
                        At DrivenStat, we take your privacy seriously. This policy explains how we collect, use, and protect your information when you use our GPS analysis service.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">2. Information We Collect</h2>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">Account Information</h3>
                        <p className="leading-relaxed">
                            When you sign up via Google, we collect your email address and basic profile information (name, avatar) to create and manage your account.
                        </p>
                    </div>
                    <div className="space-y-2 mt-4">
                        <h3 className="text-lg font-semibold">Uploaded Data</h3>
                        <p className="leading-relaxed">
                            We collect the GPX files you upload. These files contain GPS coordinates, timestamps, elevation, and speed data. This data is processed solely to generate the visualizations and statistics you see on the dashboard.
                        </p>
                    </div>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">3. How We Use Your Data</h2>
                    <ul className="list-disc pl-6 space-y-2">
                        <li>To provide the core Service functionality (map rendering, speed analysis).</li>
                        <li>To maintain and improve the performance of our application.</li>
                        <li>To communicate with you regarding your account or service updates.</li>
                    </ul>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">4. Data Storage & Security</h2>
                    <p className="leading-relaxed">
                        Your files are stored in secure cloud storage buckets (Supabase) protected by Row Level Security (RLS) policies. This means:
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li><strong>Private Activities:</strong> Only YOU can access the raw files and analysis.</li>
                            <li><strong>Public Activities:</strong> If you explicitly mark an activity as public, the analyzed data becomes accessible to anyone with the link.</li>
                        </ul>
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">5. Data Retention & Deletion</h2>
                    <p className="leading-relaxed">
                        We retain your data as long as your account is active. You have the right to request the deletion of your account and all associated data at any time. You can also delete individual activities directly from your dashboard, which permanently removes the associated files from our storage.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">6. Third-Party Services</h2>
                    <p className="leading-relaxed">
                        We use third-party services for authentication (Google) and infrastructure (Supabase). We do not sell your personal data to advertisers or third parties.
                    </p>
                </section>

                <section className="pt-8 border-t border-border">
                    <p className="text-sm text-muted-foreground">Last updated: January 2026</p>
                    <p className="text-sm text-muted-foreground mt-2">Contact: support@drivenstat.com</p>
                </section>
            </main>
        </div>
    );
};
export default Privacy;
