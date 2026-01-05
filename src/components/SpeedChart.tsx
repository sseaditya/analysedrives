import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { GPXPoint } from "@/utils/gpxParser";

interface SpeedChartProps {
  points: GPXPoint[];
  onHover?: (point: GPXPoint | null) => void;
}

interface ChartDataPoint {
  distance: number;
  speed: number;
  time: string;
  pointIndex: number;
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

const SpeedChart = ({ points, onHover }: SpeedChartProps) => {
  // Calculate speed data for chart
  const chartData: ChartDataPoint[] = [];
  let cumulativeDistance = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const distance = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    cumulativeDistance += distance;

    let speed = 0;
    if (prev.time && curr.time) {
      const timeDiff = (curr.time.getTime() - prev.time.getTime()) / 1000 / 3600;
      if (timeDiff > 0) {
        speed = distance / timeDiff;
        // Filter out GPS errors (unrealistic speeds)
        if (speed > 200) speed = 0;
      }
    }

    // Sample data to avoid too many points
    if (i % Math.max(1, Math.floor(points.length / 200)) === 0 || i === points.length - 1) {
      chartData.push({
        distance: parseFloat(cumulativeDistance.toFixed(2)),
        speed: parseFloat(speed.toFixed(1)),
        time: curr.time ? curr.time.toLocaleTimeString() : "",
        pointIndex: i,
      });
    }
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
        No time data available to calculate speed over time
      </div>
    );
  }

  // Handle mouse move to find closest point
  const handleMouseMove = (e: any) => {
    if (!e || !e.activePayload || !e.activePayload[0] || !onHover) {
      if (onHover) onHover(null);
      return;
    }

    const activeData = e.activePayload[0].payload as ChartDataPoint;
    const pointIndex = activeData.pointIndex;
    
    if (pointIndex !== undefined && pointIndex < points.length) {
      onHover(points[pointIndex]);
    }
  };

  const handleMouseLeave = () => {
    if (onHover) onHover(null);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Speed Over Distance</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart 
            data={chartData} 
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(37, 92%, 50%)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(37, 92%, 50%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(23, 5%, 82%)" opacity={0.5} />
            <XAxis
              dataKey="distance"
              stroke="hsl(24, 9%, 10%)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value} km`}
            />
            <YAxis
              stroke="hsl(24, 9%, 10%)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}`}
              label={{ value: "km/h", angle: -90, position: "insideLeft", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(60, 9%, 97%)",
                border: "1px solid hsl(23, 5%, 82%)",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              formatter={(value: number) => [`${value} km/h`, "Speed"]}
              labelFormatter={(label) => `Distance: ${label} km`}
            />
            <Area
              type="monotone"
              dataKey="speed"
              stroke="hsl(37, 92%, 50%)"
              strokeWidth={2}
              fill="url(#speedGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SpeedChart;
