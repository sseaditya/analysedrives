export interface AxisIndexedPoint {
  dist: number;
  elapsed: number;
  pointIndex: number;
}

export type SelectionAxis = 'distance' | 'time';

export function axisValueFromChartPosition(
  chartX: number,
  chartWidth: number,
  plotLeft: number,
  plotRight: number,
  domain: readonly [number, number],
): number | null {
  if (![chartX, chartWidth, plotLeft, plotRight, domain[0], domain[1]].every(Number.isFinite)) return null;

  const usableRight = chartWidth - plotRight;
  const plotWidth = usableRight - plotLeft;
  if (plotWidth <= 0) return null;

  const ratio = Math.max(0, Math.min(1, (chartX - plotLeft) / plotWidth));
  return domain[0] + ratio * (domain[1] - domain[0]);
}

export function closestPointIndexForAxisValue(
  data: readonly AxisIndexedPoint[],
  value: number,
  axis: SelectionAxis,
): number | null {
  if (data.length === 0 || !Number.isFinite(value)) return null;

  const key = axis === 'time' ? 'elapsed' : 'dist';
  let low = 0;
  let high = data.length - 1;

  if (value <= data[low][key]) return data[low].pointIndex;
  if (value >= data[high][key]) return data[high].pointIndex;

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (data[middle][key] < value) low = middle;
    else high = middle;
  }

  const lowDistance = Math.abs(data[low][key] - value);
  const highDistance = Math.abs(data[high][key] - value);
  return (lowDistance <= highDistance ? data[low] : data[high]).pointIndex;
}
