export function calculateNiceYTicks(dataMin: number, dataMax: number, targetTickCount = 7): { domain: [number, number], ticks: number[] } {
    if (dataMax <= 0) return { domain: [0, 100], ticks: [0, 20, 40, 60, 80, 100] };

    // Nice step increments to choose from
    const niceSteps = [1, 2, 5, 10, 20, 40, 50, 100, 200, 400, 500, 1000];

    // Calculate the rough step needed
    const range = dataMax - Math.max(0, dataMin);
    const roughStep = range / (targetTickCount - 1);

    // Find the best nice step
    let bestStep = niceSteps[0];
    for (const step of niceSteps) {
        if (step >= roughStep) {
            bestStep = step;
            break;
        }
        bestStep = step;
    }

    // If roughStep is larger than our largest nice step, calculate a custom one
    if (roughStep > niceSteps[niceSteps.length - 1]) {
        const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
        const fraction = roughStep / magnitude;
        if (fraction <= 1) bestStep = magnitude;
        else if (fraction <= 2) bestStep = 2 * magnitude;
        else if (fraction <= 5) bestStep = 5 * magnitude;
        else bestStep = 10 * magnitude;
    }

    // Calculate nice max (round up to next step)
    const niceMax = Math.ceil(dataMax / bestStep) * bestStep;
    const niceMin = Math.max(0, Math.floor(dataMin / bestStep) * bestStep);

    // Generate ticks
    const ticks: number[] = [];
    for (let val = niceMin; val <= niceMax; val += bestStep) {
        // Use float-safe start and step accumulation
        // Round to avoid floating point errors (e.g. 0.300000000004)
        const rawVal = niceMin + (val - niceMin);
        ticks.push(Math.round(rawVal * 10000) / 10000);
    }

    // Limit to reasonable number of ticks (5-7)
    if (ticks.length > 7) {
        // Skip every other tick
        const filtered = ticks.filter((_, i) => i % 2 === 0);
        if (filtered[filtered.length - 1] < niceMax) {
            filtered.push(niceMax);
        }
        return { domain: [niceMin, niceMax], ticks: filtered };
    }

    return { domain: [niceMin, niceMax], ticks };
}


export function calculateNiceTicks(min: number, max: number, mode: 'distance' | 'time', targetCount = 8): number[] {
    if (isNaN(min) || isNaN(max) || min > max) return [];
    const range = max - min;
    if (range <= 0) return [min];

    const ticks: number[] = [];
    let step = range / targetCount;

    if (mode === 'time') {
        // Time specific steps (seconds)
        // 10s, 30s, 60s (1m), 300s (5m), 600s (10m), 900s (15m), 1800s (30m), 3600s (1h)
        const timeSteps = [10, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200];
        let bestTimeStep = timeSteps[0];
        for (const s of timeSteps) {
            if (s >= step) {
                bestTimeStep = s;
                break;
            }
            bestTimeStep = s;
        }
        // If larger than largest, just use simple rounding logic or custom
        if (step > timeSteps[timeSteps.length - 1]) {
            bestTimeStep = Math.ceil(step / 3600) * 3600;
        }
        step = bestTimeStep;
    } else {
        // Distance steps: 0.1, 0.2, 0.5, 1, 2, 5, 10, 20...
        const distSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
        let bestDistStep = distSteps[0];
        for (const s of distSteps) {
            if (s >= step) {
                bestDistStep = s;
                break;
            }
            bestDistStep = s;
        }
        if (step > distSteps[distSteps.length - 1]) {
            bestDistStep = Math.ceil(step / 100) * 100;
        }
        step = bestDistStep;
    }

    // Generate ticks relative to min, snapped to step
    // e.g. min=13, step=5 -> start at 15
    const startTick = Math.ceil(min / step) * step;

    for (let t = startTick; t <= max; t += step) {
        // Fix float errors
        const safeT = Math.round(t * 10000) / 10000;
        if (safeT >= min && safeT <= max) {
            ticks.push(safeT);
        }
    }

    // Ensure reasonably filling the space?
    // If we ended up with too few ticks because range < step?
    // Add min and max? No, nice ticks usually shouldn't ensure min/max unless clamped.

    return ticks;
}
