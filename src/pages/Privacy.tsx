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
                    <h2 className="text-2xl font-bold text-foreground">2. Google User Data</h2>
                    <div className="p-4 border border-primary/20 bg-primary/5 rounded-lg space-y-4">
                        <p className="font-medium text-foreground">
                            DrivenStat accesses Google user data solely for authentication and account management purposes.
                        </p>

                        <div className="space-y-2">
                            <h3 className="text-lg font-semibold text-foreground">Data Accessed</h3>
                            <p className="leading-relaxed">
                                We request access to the following Google user data:
                                <ul className="list-disc pl-6 mt-1 space-y-1">
                                    <li><strong>Google Account Email:</strong> Used to uniquely identify your account and for service-related communications.</li>
                                    <li><strong>Public Profile Information:</strong> Specifically your name and profile picture (avatar), used to personalize your dashboard and public activity pages.</li>
                                </ul>
                            </p>
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-lg font-semibold text-foreground">Data Usage</h3>
                            <p className="leading-relaxed">
                                How we use this Google user data:
                                <ul className="list-disc pl-6 mt-1 space-y-1">
                                    <li><strong>Authentication:</strong> To verify your identity and allow you to log in securely.</li>
                                    <li><strong>Account Management:</strong> To create and maintain your DrivenStat user profile.</li>
                                    <li><strong>Display:</strong> To display your name and avatar on your activities if you choose to make them public.</li>
                                </ul>
                            </p>
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-lg font-semibold text-foreground">Limited Use Disclosure</h3>
                            <p className="leading-relaxed text-sm">
                                DrivenStat's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">3. Other Information We Collect</h2>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">Uploaded GPX Data</h3>
                        <p className="leading-relaxed">
                            We collect the GPX files you upload. These files contain GPS coordinates, timestamps, elevation, and speed data. This data is processed specifically to generate the visualizations and statistics you see on the dashboard. You retain full ownership of this data.
                        </p>
                    </div>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">4. Data Storage & Security</h2>
                    <p className="leading-relaxed">
                        Your files are stored in secure cloud storage buckets (Supabase) protected by strict Row Level Security (RLS) policies.
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li><strong>Private By Default:</strong> Only YOU can access the raw files and analysis.</li>
                            <li><strong>Public Sharing:</strong> If you explicitly mark an activity as public, the analyzed data becomes accessible to anyone with the link. You control this setting per-activity.</li>
                        </ul>
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">5. Data Retention & Deletion</h2>
                    <p className="leading-relaxed">
                        We retain your data as long as your account is active. You have the right to request the deletion of your account and all associated data at any time. You can delete individual activities directly from your dashboard, which immediately and permanently removes the associated files from our storage.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">6. Third-Party Services & Data Sharing</h2>
                    <p className="leading-relaxed">
                        We use reliable third-party providers for infrastructure:
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li><strong>Google Identity Services:</strong> For secure authentication.</li>
                            <li><strong>Supabase:</strong> For database and file storage.</li>
                        </ul>
                        We do <strong>not</strong> sell your personal data or Google user data to advertisers or third parties. We do not use your data for advertising purposes.
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
