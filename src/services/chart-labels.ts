const DIGIT_WIDTH = 6.5; // px per digit at the chart's 10px bold label size
const LABEL_GAP = 6;

/** True when every bar has room for its own value label without touching its neighbours. */
export function valueLabelsFit(columnWidth: number, maxValue: number): boolean {
  const digits = String(Math.max(Math.round(maxValue), 0)).length;
  return columnWidth >= digits * DIGIT_WIDTH + LABEL_GAP;
}

/**
 * Which bars get a value label. With room, every bar with something to show; when the chart is crowded (years of
 * data in a small window) only the tallest bar is labelled, and hovering a bar still gives the exact figure.
 */
export function showValueLabel(index: number, values: number[], columnWidth: number): boolean {
  const value = values[index];
  if (!(value > 0)) return false;
  const max = Math.max(...values);
  return valueLabelsFit(columnWidth, max) || index === values.indexOf(max);
}
