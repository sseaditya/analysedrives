import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const Terms = () => {
    const navigate = useNavigate();
    return (
        <div className="min-h-screen bg-background flex flex-col font-sans">
            <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <h1 className="text-xl font-bold">Terms of Service</h1>
                </div>
            </header>
            <main className="container mx-auto px-4 py-8 max-w-3xl space-y-8 text-foreground/90">
                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">1. Acceptance of Terms</h2>
                    <p className="leading-relaxed">
                        By accessing and using DrivenStat ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">2. Description of Service</h2>
                    <p className="leading-relaxed">
                        DrivenStat provides GPS data analysis tools for motorsport and driving enthusiasts. Users can upload GPX files to visualize speed, elevation, and other metrics. The Service is provided "as-is" and is intended for informational and entertainment purposes only.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">3. User Accounts & Data</h2>
                    <p className="leading-relaxed">
                        You are responsible for maintaining the security of your account credentials. You retain full ownership of any data (GPX files) you upload to the Service. By uploading data, you grant DrivenStat a license to process and display that data solely for the purpose of providing the Service to you.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">4. Privacy & Public Sharing</h2>
                    <p className="leading-relaxed">
                        By default, your uploaded activities are private. You may choose to make specific activities "Public," which generates a unique link viewable by anyone. You are solely responsible for any sensitive location data contained within files you choose to share publicly. We provide tools (such as Privacy Zones) to help mask start/end locations, but cannot guarantee the removal of all identifying data from raw GPS files.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">5. Prohibited Conduct</h2>
                    <p className="leading-relaxed">
                        You agree not to use the Service to:
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Upload malicious code or data.</li>
                            <li>Harass, abuse, or harm others.</li>
                            <li>Violate any applicable laws or regulations.</li>
                            <li>Attempt to reverse engineer or promote competing services using our data.</li>
                        </ul>
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">6. Limitation of Liability</h2>
                    <p className="leading-relaxed">
                        To the maximum extent permitted by law, DrivenStat shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits or data, arising out of or in connection with your use of the Service.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-foreground">7. Changes to Terms</h2>
                    <p className="leading-relaxed">
                        We reserve the right to modify these terms at any time. Continued use of the Service constitutes acceptance of the modified terms.
                    </p>
                </section>

                <section className="pt-8 border-t border-border">
                    <p className="text-sm text-muted-foreground">Last updated: January 2026</p>
                </section>
            </main>
        </div>
    );
};
export default Terms;
