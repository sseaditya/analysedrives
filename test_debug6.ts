import { calculateStats, GPXPoint, STOP_SPEED_THRESHOLD } from './src/utils/gpxParser';

function generateRoute(numPoints: number): GPXPoint[] {
    const points: GPXPoint[] = [];
    const seg1Points = Math.floor(numPoints * 0.75);
    const seg2Points = numPoints - seg1Points;

    let lat = 0.0000; let lon = 0.0000;
    const step1 = 0.027 / seg1Points;

    for (let i = 0; i < seg1Points; i++) {
        lat += step1; lon += step1;
        points.push({ lat, lon, ele: 10, time: new Date(1672531200000 + i * (180000 / numPoints)) });
    }

    const step2 = 0.009 / seg2Points;
    for (let i = 0; i < seg2Points; i++) {
        lat += step2; lon -= step2;
        points.push({ lat, lon, ele: 10, time: new Date(1672531200000 + (seg1Points * (180000 / numPoints)) + i * (180000 / numPoints)) });
    }
    return points;
}

const points = generateRoute(30000);
const stats = calculateStats(points);
console.log("ROTATION:", stats.totalHeadingChange);
console.log("TWISTINESS:", stats.twistinessScore);
