/**
 * Analytics chart palette — validated with the dataviz six-checks validator
 * against our real surfaces (light card #ffffff, dark card #18181b):
 * adjacent-pair CVD ΔE ≥ 8.4 and normal-vision ΔE ≥ 19.3 in both modes.
 * The slot ORDER is the colorblind-safety mechanism — never reorder or cycle;
 * a 9th series folds into "Other" (see seriesSlots).
 *
 * Three light slots (magenta/yellow/aqua) sit below 3:1 contrast on white —
 * the relief rule applies: every chart ships with the summary panel that
 * lists exact values, and marks carry 2px surface gaps.
 */

export interface ChartChrome {
  surface: string;
  grid: string;
  axisLine: string;
  axisText: string;
  inkPrimary: string;
  inkSecondary: string;
  other: string;
}

export const CATEGORICAL_LIGHT = [
  '#2a78d6', // blue
  '#008300', // green
  '#e87ba4', // magenta
  '#eda100', // yellow
  '#1baf7a', // aqua
  '#eb6834', // orange
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

export const CATEGORICAL_DARK = [
  '#3987e5',
  '#008300',
  '#d55181',
  '#c98500',
  '#199e70',
  '#d95926',
  '#9085e9',
  '#e66767',
] as const;

/** Money polarity — status colors, never reused as series slots. */
export const FLOW_COLORS = {
  light: { positive: '#0ca30c', negative: '#d03b3b' },
  dark: { positive: '#0ca30c', negative: '#d03b3b' },
} as const;

export const CHROME_LIGHT: ChartChrome = {
  surface: '#ffffff',
  grid: '#e9e9ec',
  axisLine: '#d4d4d8',
  axisText: '#71717a',
  inkPrimary: '#18181b',
  inkSecondary: '#52525b',
  other: '#a1a1aa',
};

export const CHROME_DARK: ChartChrome = {
  surface: '#18181b',
  grid: '#2c2c30',
  axisLine: '#3f3f46',
  axisText: '#a1a1aa',
  inkPrimary: '#fafafa',
  inkSecondary: '#c5c5cb',
  other: '#6b6b74',
};

export function getPalette(dark: boolean) {
  return {
    series: dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT,
    flow: dark ? FLOW_COLORS.dark : FLOW_COLORS.light,
    chrome: dark ? CHROME_DARK : CHROME_LIGHT,
  };
}

export type Palette = ReturnType<typeof getPalette>;

/**
 * Assign slots to entity keys in their given (stable) order. Color follows
 * the entity, never its rank — callers must pass keys in a stable order
 * (e.g. sorted by id/name), not by current magnitude.
 */
export function assignSeriesColors(
  keys: string[],
  series: readonly string[],
  otherColor: string
): Map<string, string> {
  const out = new Map<string, string>();
  keys.forEach((key, index) => {
    out.set(key, index < series.length ? series[index] : otherColor);
  });
  return out;
}
