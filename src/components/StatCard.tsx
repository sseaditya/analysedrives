import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  className?: string;
  delay?: number;
}

const StatCard = ({
  label,
  value,
  subValue,
  className,
  delay = 0,
}: StatCardProps) => {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-card border border-border p-4 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1",
        "animate-in fade-in slide-in-from-bottom-4",
        className
      )}
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </p>
          <p className="text-xl lg:text-2xl font-bold text-foreground truncate">{value}</p>
          {subValue && (
            <p className="text-xs text-muted-foreground truncate">{subValue}</p>
          )}
        </div>
      </div>

      {/* Decorative gradient */}
      <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-primary/5 rounded-full blur-2xl" />
    </div>
  );
};

export default StatCard;
