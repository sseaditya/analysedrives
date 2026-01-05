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

interface ElevationChartProps {
  points: GPXPoint[];
}

interface ChartDataPoint {
  distance: number;
  elevation: number;
  time: string;
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

const ElevationChart = ({ points }: ElevationChartProps) => {
  // Calculate elevation data for chart
  const chartData: ChartDataPoint[] = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];

    // Calculate cumulative distance
    if (i > 0) {
      const prev = points[i - 1];
      const distance = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
      cumulativeDistance += distance;
    }

    // Only include points with elevation data
    if (curr.ele !== undefined) {
      // Sample data to avoid too many points
      if (i % Math.max(1, Math.floor(points.length / 200)) === 0 || i === points.length - 1) {
        chartData.push({
          distance: parseFloat(cumulativeDistance.toFixed(2)),
          elevation: parseFloat(curr.ele.toFixed(1)),
          time: curr.time ? curr.time.toLocaleTimeString() : "",
        });
      }
    }
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">
        No elevation data available to display elevation profile
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Elevation Profile</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="elevationGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
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
              label={{ value: "m", angle: -90, position: "insideLeft", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(60, 9%, 97%)",
                border: "1px solid hsl(23, 5%, 82%)",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              formatter={(value: number) => [`${value} m`, "Elevation"]}
              labelFormatter={(label) => `Distance: ${label} km`}
            />
            <Area
              type="monotone"
              dataKey="elevation"
              stroke="hsl(142, 76%, 36%)"
              strokeWidth={2}
              fill="url(#elevationGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ElevationChart;

