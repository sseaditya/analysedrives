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
            <main className="container mx-auto px-4 py-8 max-w-prose space-y-6 text-foreground">
                <h2 className="text-2xl font-bold">1. Introduction</h2>
                <p>By using DrivenStat, you agree to these terms.</p>
                <h2 className="text-2xl font-bold">2. Usage</h2>
                <p>You may upload GPX files for analysis. You retain ownership of your data.</p>
                <h2 className="text-2xl font-bold">3. Disclaimer</h2>
                <p>The service is provided "as is" without warranties.</p>
                {/* Add more detailed terms here */}
            </main>
        </div>
    );
};
export default Terms;
