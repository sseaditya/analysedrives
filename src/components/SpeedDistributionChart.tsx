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

        const collapsedData: SpeedBucket[] = [];
        let overflowDist = 0;

        // Find the bucket that represents the speed limit (e.g. 90-100 for limit 100)
        // Or if limit is 95, it falls in 90-100.
        // We want to keep buckets where minSpeed < speedLimit.

        for (const bucket of rawData) {
            if (bucket.minSpeed < speedLimit) {
                collapsedData.push({ ...bucket });
            } else {
                // This bucket is entirely above or starting at the limit
                // Accumulate its distance
                overflowDist += bucket.distance;
            }
        }

        // If we have overflow, simulate physics:
        // All that distance was covered at exactly speedLimit
        if (overflowDist > 0) {
            const simulatedTime = (overflowDist / speedLimit) * 60; // minutes

            // We need to put this into the "last" bucket, OR create a new one if it doesn't exist?
            // The user said "showing bars till speed cap".
            // Ideally, if limit is 100, we want the bar 90-100 to increase.
            // minSpeed for that bucket is 90 (if step is 10).
            // If limit is 100, the bucket starting at 100 is excluded.

            // Let's find the bucket that *contains* the limit - 1 (the speed just below limit)
            // If limit is 100, we want bucket 90.
            // If limit is 45, we want bucket 40 (40-50).

            // Actually, simpler: The last bucket in collapsedData is the one effectively "at the limit".

            if (collapsedData.length > 0) {
                const lastBucket = collapsedData[collapsedData.length - 1];
                // Should we add to it?
                // Only if the limit falls within it or is its upper bound.
                // If limit is 100, last bucket is 90-100. We add to it.
                // If limit is 40, last bucket is 30-40. We add to it.

                // BUT, what if the last bucket is way below limit? (e.g. max speed was 30, limit is 100).
                // Then overflowDist is 0 anyway.

                // What if max speed was 200. Bucket 190.
                // Collapsed includes up to 90.
                // We add overflow to 90.

                lastBucket.distance += overflowDist;
                lastBucket.time += simulatedTime;

                // Fix precision
                lastBucket.distance = Number(lastBucket.distance.toFixed(2));
                lastBucket.time = Number(lastBucket.time.toFixed(2));
            } else {
                // Limit is very low (e.g. < 10) or data is weird.
                // Create a bucket 0-10?
                if (collapsedData.length === 0 && rawData.length > 0) {
                    // If limit is < 10, collapsed is empty.
                    // Create a 0-10 bucket (clamped).
                    collapsedData.push({
                        range: `0-${speedLimit}`,
                        minSpeed: 0,
                        time: Number(simulatedTime.toFixed(2)),
                        distance: Number(overflowDist.toFixed(2))
                    });
                }
            }
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
