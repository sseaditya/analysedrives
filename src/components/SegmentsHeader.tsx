import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import HeaderProfile from "@/components/HeaderProfile";

export default function SegmentsHeader({ backTo, title }: { backTo?: string; title?: string }) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-[1001] border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-4">
          <button
            type="button"
            className="shrink-0 text-xl font-bold text-foreground"
            onClick={() => navigate("/dashboard")}
            aria-label="Go to DrivenStat dashboard"
          >
            DrivenStat
          </button>
          <div className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
          {backTo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => navigate(backTo)}
              aria-label="Go back"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <button
            type="button"
            className="min-w-0 truncate text-left font-semibold text-foreground transition-colors hover:text-primary"
            onClick={() => navigate("/segments")}
          >
            {title ?? "Segments"}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ThemeToggle />
          <HeaderProfile />
        </div>
      </div>
    </header>
  );
}
