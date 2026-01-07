
import React, { useMemo } from 'react';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    Brush,
    XAxis,
    YAxis
} from 'recharts';
import { GPXPoint } from '@/utils/gpxParser';

interface ChartRangeSliderProps {
    points: GPXPoint[];
    zoomRange: [number, number] | null;
    onZoomChange: (range: [number, number] | null) => void;
    height?: number;
}

// Haversine formula
function haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

const ChartRangeSlider: React.FC<ChartRangeSliderProps> = ({
    points,
    zoomRange,
    onZoomChange,
    height = 80
}) => {
    const chartData = useMemo(() => {
        let cumulativeDistance = 0;
        const data = [];

        if (points.length > 0) {
            data.push({
                index: 0,
                distance: 0,
                elevation: points[0].ele ?? 0,
            });
        }

        // Downsample if needed for performance, but need to be careful with index mapping.
        // Recharts Brush works on indices of the provided data array.
        // If we want accurate mapping, we should pass all points or a consistent subsample.
        // For now, passing all points is safest for index alignment.
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];

            const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            cumulativeDistance += dist;

            data.push({
                index: i,
                distance: parseFloat(cumulativeDistance.toFixed(3)),
                elevation: curr.ele ?? 0,
            });
        }
        return data;
    }, [points]);

    const handleBrushChange = (newIndex: any) => {
        if (newIndex && typeof newIndex.startIndex === 'number' && typeof newIndex.endIndex === 'number') {
            const { startIndex, endIndex } = newIndex;
            if (startIndex === 0 && endIndex === points.length - 1) {
                onZoomChange(null);
            } else {
                onZoomChange([startIndex, endIndex]);
            }
        }
    };

    return (
        <div className="w-full select-none" style={{ height: height }}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={chartData}
                    // Match the margins of SpeedElevationChart: top: 10, right: 30, left: 0, bottom: 0 
                    // SpeedElevationChart has 30px right margin. 
                    // SpeedElevationChart has 0px left margin, but 60px Axis.
                    // We must replicate this structure.
                    margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                >
                    <defs>
                        <linearGradient id="brushGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8884d8" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#8884d8" stopOpacity={0.1} />
                        </linearGradient>
                    </defs>

                    <XAxis
                        dataKey="distance"
                        type="number" // Ensure linear distribution by distance
                        domain={['dataMin', 'dataMax']}
                        axisLine={false}
                        tickLine={{ stroke: '#9ca3af', height: 4 }}
                        tickFormatter={(val) => `${Math.round(val)} km`}
                        minTickGap={50}
                        interval="preserveStartEnd"
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        dy={4}
                    />

                    {/* Dummy Left Axis to match SpeedElevationChart spacing (width=60) */}
                    <YAxis
                        yAxisId="left"
                        orientation="left"
                        width={60}
                        hide // It's invisible, just here for spacing
                        domain={['dataMin', 'dataMax']}
                    />

                    {/* Dummy Right Axis to match SpeedElevationChart spacing (width=60) */}
                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        width={60}
                        hide
                        domain={['dataMin', 'dataMax']}
                    />

                    <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="elevation"
                        stroke="hsl(262, 83%, 58%)"
                        fill="url(#brushGradient)"
                        strokeWidth={1}
                        isAnimationActive={false}
                    />

                    <Brush
                        travellerWidth={10}
                        height={height - 20}
                        y={0}
                        dataKey="index"
                        stroke="hsl(262, 83%, 58%)"
                        fill="hsl(var(--background))"
                        tickFormatter={() => ''}
                        startIndex={zoomRange ? zoomRange[0] : 0}
                        endIndex={zoomRange ? zoomRange[1] : (points.length - 1)}
                        onChange={handleBrushChange}
                        alwaysShowText={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ChartRangeSlider;
