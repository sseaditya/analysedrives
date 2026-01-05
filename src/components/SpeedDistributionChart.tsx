import { useMemo } from "react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { GPXPoint, calculateSpeedDistribution, SpeedBucket } from "@/utils/gpxParser";

interface SpeedDistributionChartProps {
    points: GPXPoint[];
    speedLimit?: number | null;
}

const SpeedDistributionChart = ({ points, speedLimit }: SpeedDistributionChartProps) => {
    // Force bucket size of 10 and ensure range starts at 0
    const data = useMemo(() => {
        const rawData = calculateSpeedDistribution(points, 10);

        if (!speedLimit || speedLimit <= 0 || !rawData || rawData.length === 0) {
            return rawData;
        }

        // The bucket that will receive overflow is the one just BELOW the speed limit
        // For speedLimit=100, the limit bucket is 90-100 (minSpeed=90)
        const limitBucketMin = speedLimit - 10;

        const collapsedData: SpeedBucket[] = [];
        let overLimitTime = 0;
        let overLimitDistance = 0;

        for (const bucket of rawData) {
            if (bucket.minSpeed >= speedLimit) {
                // This entire bucket is at or over the limit
                // We only cascade distance, and will calculate time based on the limit speed
                overLimitDistance += bucket.distance;
            } else {
                // Bucket is below the limit - keep it
                collapsedData.push({ ...bucket }); // Clone to avoid mutating original
            }
        }

        // Calculate time for the overflow distance based on the speed limit
        // Time (min) = (Distance (km) / Speed (km/h)) * 60
        overLimitTime = (overLimitDistance / speedLimit) * 60;

        // Find the bucket just below the limit and add overflow to it
        const targetBucket = collapsedData.find(b => b.minSpeed === limitBucketMin);
        if (targetBucket) {
            targetBucket.time = Number((targetBucket.time + overLimitTime).toFixed(2));
            targetBucket.distance = Number((targetBucket.distance + overLimitDistance).toFixed(2));
        } else if (overLimitTime > 0 || overLimitDistance > 0) {
            // Create the limit bucket if it doesn't exist
            collapsedData.push({
                range: `${limitBucketMin}-${limitBucketMin + 10}`,
                minSpeed: limitBucketMin,
                time: Number(overLimitTime.toFixed(2)),
                distance: Number(overLimitDistance.toFixed(2))
            });
        }

        // Sort buckets by speed
        return collapsedData.sort((a, b) => a.minSpeed - b.minSpeed);
    }, [points, speedLimit]);

    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] w-full flex items-center justify-center bg-card border border-border rounded-xl">
                <p className="text-muted-foreground">Not enough data for distribution</p>
            </div>
        );
    }

    // Calculate max value to synchronize axes 1:1
    // We find the absolute maximum value across both time(min) and distance(km)
    // and set the domain of BOTH axes to [0, maxVal]
    const maxTime = Math.max(...data.map(d => d.time));
    const maxDist = Math.max(...data.map(d => d.distance));
    const maxVal = Math.ceil(Math.max(maxTime, maxDist) * 1.1); // Add 10% headroom

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                data={data}
                margin={{ top: 0, right: 0, left: -20, bottom: 20 }}
            >
                <defs>
                    <linearGradient id="colorTime" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="colorDist" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.3} />
                <XAxis
                    dataKey="range"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ dy: 10 }}
                    label={{ value: "Speed Range (km/h)", position: "insideBottom", offset: -5, fontSize: 10, fill: "currentColor", opacity: 0.5 }}
                />
                <YAxis
                    yAxisId="left"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `${val}m`}
                    domain={[0, maxVal]}
                />
                <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `${val}km`}
                    domain={[0, maxVal]}
                />
                <Tooltip
                    contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '16px',
                        fontSize: '12px',
                        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
                    }}
                    cursor={{ fill: 'hsl(var(--muted)/0.2)' }}
                    formatter={(value: number, name: string) => {
                        if (name === "Time (min)") return [`${value.toFixed(1)} min`, name];
                        if (name === "Distance (km)") return [`${value.toFixed(2)} km`, name];
                        return [value, name];
                    }}
                />
                <Bar
                    yAxisId="left"
                    dataKey="time"
                    name="Time (min)"
                    fill="url(#colorTime)"
                    stroke="#3b82f6"
                    strokeWidth={1}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                    animationDuration={1000}
                />
                <Bar
                    yAxisId="right"
                    dataKey="distance"
                    name="Distance (km)"
                    fill="url(#colorDist)"
                    stroke="#22c55e"
                    strokeWidth={1}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                    animationDuration={1000}
                />
            </BarChart>
        </ResponsiveContainer>
    );
};

export default SpeedDistributionChart;
