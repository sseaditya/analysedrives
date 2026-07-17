import { describe, expect, it } from 'vitest';
import {
  axisValueFromChartPosition,
  closestPointIndexForAxisValue,
} from './chartSelection';

describe('timeline range selection', () => {
  it('maps the pointer continuously across the numeric chart domain', () => {
    expect(axisValueFromChartPosition(320, 610, 60, 30, [0, 100])).toBe(50);
    expect(axisValueFromChartPosition(0, 610, 60, 30, [0, 100])).toBe(0);
    expect(axisValueFromChartPosition(700, 610, 60, 30, [0, 100])).toBe(100);
  });

  it('resolves the selected value against full-resolution data, not display samples', () => {
    const raw = Array.from({ length: 1_001 }, (_, pointIndex) => ({
      dist: pointIndex / 100,
      elapsed: pointIndex,
      pointIndex,
    }));

    expect(closestPointIndexForAxisValue(raw, 3.004, 'distance')).toBe(300);
    expect(closestPointIndexForAxisValue(raw, 3.006, 'distance')).toBe(301);
    expect(closestPointIndexForAxisValue(raw, 350.4, 'time')).toBe(350);
  });

  it('clamps safely at both track boundaries', () => {
    const raw = [
      { dist: 2, elapsed: 20, pointIndex: 4 },
      { dist: 4, elapsed: 40, pointIndex: 8 },
    ];

    expect(closestPointIndexForAxisValue(raw, -10, 'distance')).toBe(4);
    expect(closestPointIndexForAxisValue(raw, 100, 'distance')).toBe(8);
  });

  it('keeps deterministic behavior when consecutive points share an axis value', () => {
    const raw = [
      { dist: 0, elapsed: 0, pointIndex: 0 },
      { dist: 1, elapsed: 10, pointIndex: 1 },
      { dist: 1, elapsed: 10, pointIndex: 2 },
      { dist: 2, elapsed: 20, pointIndex: 3 },
    ];

    expect(closestPointIndexForAxisValue(raw, 1, 'distance')).toBe(1);
    expect(closestPointIndexForAxisValue(raw, 10, 'time')).toBe(1);
  });
});
