import { useState, useMemo } from "react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceArea,
    ReferenceLine,
} from "recharts";
import { GPXPoint, haversineDistance } from "@/utils/gpxParser";
import { useIsMobile } from "@/hooks/use-mobile";

interface DistanceTimeChartProps {
    points: GPXPoint[];
    zoomRange: [number, number] | null;
    onZoomChange: (range: [number, number] | null) => void;
    speedLimit?: number | null;
    speedCap?: number | null;
}

interface ChartDataPoint {
    elapsedTime: number; // seconds from start
    distance: number; // km
    pointIndex: number;
}

// Format elapsed time for axis display (e.g., "30m", "1h", "1h 30m")
function formatTimeAxis(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        if (minutes === 0) return `${hours}h`;
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

const DistanceTimeChart = ({
    points,
    zoomRange,
    onZoomChange,
    speedLimit,
    speedCap,
}: DistanceTimeChartProps) => {
    const isMobile = useIsMobile();
    const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
    const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
    // Calculate chart data with cumulative distance and elapsed time
    const fullData: ChartDataPoint[] = useMemo(() => {
        if (points.length < 2) return [];

        const startTime = points[0]?.time?.getTime() || 0;
        let cumulativeDistance = 0;
        const result: ChartDataPoint[] = [];

        // Sample rate to keep ~500 points
        const sampleRate = Math.max(1, Math.floor(points.length / 500));

        for (let i = 0; i < points.length; i++) {
            if (i > 0) {
                const prev = points[i - 1];
                const curr = points[i];
                const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);

                // When speed limit is active, calculate adjusted distance based on capped speed
                if (speedLimit && speedLimit > 0 && prev.time && curr.time) {
                    const timeDiff = (curr.time.getTime() - prev.time.getTime()) / 1000 / 3600; // hours
                    if (timeDiff > 0) {
                        const segmentSpeed = dist / timeDiff;
                        // Distance stays same regardless of speed limit since we're using actual distance traveled
                        cumulativeDistance += dist;
                    }
                } else {
                    cumulativeDistance += dist;
                }
            }

            const shouldSample = (i % sampleRate === 0) || i === points.length - 1;

            if (shouldSample) {
                const elapsedTime = points[i]?.time
                    ? (points[i].time!.getTime() - startTime) / 1000
                    : 0;

                result.push({
                    elapsedTime,
                    distance: parseFloat(cumulativeDistance.toFixed(2)),
                    pointIndex: i,
                });
            }
        }

        return result;
    }, [points, speedLimit]);

    // Filter by zoom range
    const chartData = useMemo(() => {
        if (!zoomRange) return fullData;
        return fullData.filter(d => d.pointIndex >= zoomRange[0] && d.pointIndex <= zoomRange[1]);
    }, [fullData, zoomRange]);

    if (chartData.length === 0) {
        return (
            <div className="h-[200px] w-full flex items-center justify-center bg-card border border-border rounded-xl">
                <p className="text-muted-foreground">Not enough data for chart</p>
            </div>
        );
    }

    // Calculate domains
    const minTime = chartData[0]?.elapsedTime || 0;
    const maxTime = chartData[chartData.length - 1]?.elapsedTime || 0;
    const minDist = chartData[0]?.distance || 0;
    const maxDist = chartData[chartData.length - 1]?.distance || 0;

    const zoom = () => {
        if (refAreaLeft === refAreaRight || refAreaRight === null || refAreaLeft === null) {
            setRefAreaLeft(null);
            setRefAreaRight(null);
            return;
        }

        // Identify start/end times
        let leftTime = parseFloat(refAreaLeft);
        let rightTime = parseFloat(refAreaRight);

        if (leftTime > rightTime) [leftTime, rightTime] = [rightTime, leftTime];

        const startData = fullData.find(p => p.elapsedTime >= leftTime);
        const endData = fullData.find(p => p.elapsedTime >= rightTime);

        if (startData && endData) {
            const startIndex = startData.pointIndex;
            const endIndex = endData.pointIndex;

            if (startIndex !== endIndex) {
                onZoomChange([startIndex, endIndex]);
            }
        }

        setRefAreaLeft(null);
        setRefAreaRight(null);
    };

    const handleMouseDown = (e: any) => {
        if (isMobile) return;
        if (e && e.activeLabel) {
            setRefAreaLeft(e.activeLabel);
        }
    };

    const handleMouseMove = (e: any) => {
        if (isMobile) return;
        if (refAreaLeft && e && e.activeLabel) {
            setRefAreaRight(e.activeLabel);
        }
    };

    const handleMouseUp = () => {
        if (isMobile) return;
        if (refAreaLeft) {
            zoom();
        }
        setRefAreaLeft(null);
        setRefAreaRight(null);
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart
                data={chartData}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <defs>
                    <linearGradient id="distanceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(23, 5%, 82%)" opacity={0.5} />
                <XAxis
                    dataKey="elapsedTime"
                    type="number"
                    domain={[minTime, maxTime]}
                    stroke="hsl(var(--foreground))"
                    strokeOpacity={0.6}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickCount={8}
                    tickFormatter={formatTimeAxis}
                    allowDataOverflow
                />
                <YAxis
                    stroke="hsl(15, 52%, 58%)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value.toFixed(1)} km`}
                    label={{ value: "Distance (km)", angle: -90, position: "insideLeft", fontSize: 12, fill: "hsl(15, 52%, 58%)" }}
                    width={60}
                    domain={[minDist, maxDist + (maxDist - minDist) * 0.1]}
                />
                <Tooltip
                    contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '16px',
                        fontSize: '12px',
                        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
                    }}
                    formatter={(value: number, name: string) => {
                        if (name === "distance") return [`${value.toFixed(2)} km`, "Distance"];
                        return [value, name];
                    }}
                    labelFormatter={(label) => {
                        const seconds = label as number;
                        const h = Math.floor(seconds / 3600);
                        const m = Math.floor((seconds % 3600) / 60);
                        const s = Math.floor(seconds % 60);
                        return `Time: ${h}h ${m}m ${s}s`;
                    }}
                />
                <Area
                    type="monotone"
                    dataKey="distance"
                    stroke="hsl(15, 52%, 58%)"
                    strokeWidth={2}
                    fill="url(#distanceGradient)"
                    isAnimationActive={false}
                />
                {refAreaLeft && refAreaRight && (
                    <ReferenceArea
                        x1={refAreaLeft}
                        x2={refAreaRight}
                        strokeOpacity={0.3}
                        fill="hsl(var(--primary))"
                        fillOpacity={0.1}
                    />
                )}
            </AreaChart>
        </ResponsiveContainer>
    );
};

export default DistanceTimeChart;
