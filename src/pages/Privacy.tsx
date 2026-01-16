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
            <main className="container mx-auto px-4 py-8 max-w-prose space-y-6 text-foreground">
                <h2 className="text-2xl font-bold">Data Collection</h2>
                <p>We process your GPX files to provide analysis. Files are stored securely in your private storage bucket (unless you choose to make them public).</p>
                <h2 className="text-2xl font-bold">Data Deletion</h2>
                <p>You can delete your activities and account data at any time.</p>
            </main>
        </div>
    );
};
export default Privacy;
