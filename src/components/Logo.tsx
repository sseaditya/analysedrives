import { cn } from "@/lib/utils";

interface LogoProps {
    className?: string;
}

export const Logo = ({ className }: LogoProps) => {
    return (
        <svg
            viewBox="0 0 100 100" // Increased viewbox for better text rendering alignment
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn("w-10 h-10", className)}
        >
            <text
                x="50"
                y="52"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="60"
                fontWeight="800"
                fontFamily="Inter, sans-serif"
                className="fill-foreground tracking-tighter"
            >
                DS
            </text>
        </svg>
    );
};
