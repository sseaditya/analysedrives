import { useNavigate } from "react-router-dom";
import { ArrowLeft, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import HeaderProfile from "@/components/HeaderProfile";

export default function SegmentsHeader({ backTo, title }: { backTo?: string; title?: string }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-[1001] border-b border-border bg-card/80 backdrop-blur-md">
      <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {backTo && <Button variant="ghost" size="icon" onClick={() => navigate(backTo)}><ArrowLeft className="h-4 w-4" /></Button>}
          <button className="flex items-center gap-2" onClick={() => navigate("/segments")}>
            <Route className="h-5 w-5 text-primary" />
            <span className="font-bold">{title ?? "Road Segments"}</span>
          </button>
        </div>
        <div className="flex items-center gap-3"><ThemeToggle /><HeaderProfile /></div>
      </div>
    </header>
  );
}
