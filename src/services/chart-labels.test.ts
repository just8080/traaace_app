import { describe, expect, it } from 'vitest';
import { showValueLabel, valueLabelsFit } from './chart-labels';

describe('value labels on the timeline', () => {
  it('fits labels when each column is wide enough for the biggest number', () => {
    expect(valueLabelsFit(20, 216)).toBe(false);
    expect(valueLabelsFit(30, 216)).toBe(true);
    expect(valueLabelsFit(14, 9)).toBe(true);
    expect(valueLabelsFit(10, 9)).toBe(false);
  });

  it('labels every non-empty bar when there is room', () => {
    const values = [3, 0, 7];
    expect([0, 1, 2].map(i => showValueLabel(i, values, 60))).toEqual([true, false, true]);
  });

  it('labels only the tallest bar when the chart is crowded', () => {
    const values = [145, 216, 141, 216, 87];
    expect(values.map((_, i) => showValueLabel(i, values, 8))).toEqual([false, true, false, false, false]);
  });

  it('shows nothing for an all-empty chart', () => {
    expect(showValueLabel(0, [0, 0], 8)).toBe(false);
  });
});
