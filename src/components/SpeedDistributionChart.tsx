import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from "recharts";
import { useMemo } from "react";
import { applySpeedLimitToDistribution, GPXPoint, calculateSpeedDistribution, SpeedBucket } from "@/utils/gpxParser";
import { calculateNiceYTicks } from "@/utils/chartUtils";
import { chartAxisLabel, chartAxisTick } from "@/utils/chartStyles";



interface SpeedDistributionChartProps {
    points?: GPXPoint[];
    speedLimit?: number | null;
    buckets?: SpeedBucket[];
}

const SpeedDistributionChart = ({ points, speedLimit, buckets }: SpeedDistributionChartProps) => {
    // Force bucket size of 10 and ensure range starts at 0
    const data = useMemo(() => {
        // If pre-calculated buckets are provided, use them directly (filtering by speedLimit handled by caller or valid here too)
        if (buckets) {
            return buckets;
        }

        if (!points) return [];

        return applySpeedLimitToDistribution(calculateSpeedDistribution(points, 10), speedLimit);
    }, [points, speedLimit, buckets]);

    // Calculate max value to synchronize axes 1:1
    // We find the absolute maximum value across both time(min) and distance(km)
    // and set the domain of BOTH axes to [0, maxVal]
    // Use nice tick calculation
    const maxTime = data && data.length > 0 ? Math.max(...data.map(d => d.time)) : 10;
    const maxDist = data && data.length > 0 ? Math.max(...data.map(d => d.distance)) : 10;
    const rawMax = Math.max(maxTime, maxDist);

    // We want the domain to be [0, niceMax] where niceMax is "nice" for rawMax.
    // Ensure we don't apply an arbitrary 1.1 scale which might break integer alignment if not handled carefully by utils.
    const yAxisConfig = useMemo(() => calculateNiceYTicks(0, rawMax, 7), [rawMax]);

    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] w-full flex items-center justify-center bg-card border border-border rounded-xl">
                <p className="text-muted-foreground">Not enough data for distribution</p>
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                data={data}
                margin={{ top: 10, right: 6, left: -12, bottom: 30 }}
            >
                <defs>
                    <linearGradient id="colorTime" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="hsl(15, 52%, 58%)" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="colorDist" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--foreground))" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0.1} />
                    </linearGradient>
                </defs>
                {/* Custom Grid using ReferenceLines */}
                {yAxisConfig.ticks.map((tickVal) => (
                    <ReferenceLine
                        key={`grid-h-${tickVal}`}
                        y={tickVal}
                        yAxisId="left"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={0.5}
                        strokeOpacity={0.6}
                        isFront={false}
                    />
                ))}
                <XAxis
                    dataKey="range"
                    stroke="#ffffff"
                    tickLine={false}
                    axisLine={false}
                    tick={{ ...chartAxisTick, dy: 10 }}
                    minTickGap={8}
                    label={{ value: "Speed Range (km/h)", position: "insideBottom", offset: -8, dy: 5, ...chartAxisLabel }}
                />
                <YAxis
                    yAxisId="left"
                    stroke="#ffffff"
                    tick={chartAxisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `${val}m`}
                    domain={yAxisConfig.domain}
                    ticks={yAxisConfig.ticks}
                    interval={0}
                />
                <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#ffffff"
                    tick={chartAxisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `${val}km`}
                    domain={yAxisConfig.domain}
                    ticks={yAxisConfig.ticks}
                    interval={0}
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
                        if (name === "Distance (km)") return [`${value.toFixed(1)} km`, name];
                        return [value, name];
                    }}
                />
                <Bar
                    yAxisId="left"
                    dataKey="time"
                    name="Time (min)"
                    fill="url(#colorTime)"
                    stroke="hsl(15, 52%, 58%)"
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
                    stroke="hsl(var(--foreground))"
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
