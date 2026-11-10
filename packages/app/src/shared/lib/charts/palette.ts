/**
 * Categorical chart palette: 12 slots in the Tableau-10 family (plus light
 * blue, olive and indigo), ordered so neighbours differ in both hue and
 * lightness: blue, orange, green, red, purple, mustard, teal, brown, pink,
 * light blue, olive, indigo. No two greens or blues sit side by side, the
 * blue / orange / red / green opening stays apart for red-green colour
 * blindness, and there is no neon. The dark set is the same hues, lifted
 * for the dark surface. Slot order is part of the design: series keep
 * their slot (position), never their rank, so a series has one colour in
 * grouped, stacked and 100% charts and in the legend.
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
  '#4e79a7', // blue
  '#f28e2b', // orange
  '#59a14f', // green
  '#e15759', // red
  '#b07aa1', // purple
  '#d4a72c', // mustard
  '#5fa9a3', // teal
  '#9c755f', // brown
  '#f08ca0', // pink
  '#8fbbe0', // light blue
  '#a5a51f', // olive
  '#6b6ecf', // indigo
] as const;

export const CATEGORICAL_DARK = [
  '#6a96c9', // blue
  '#f5a04a', // orange
  '#6cbf5f', // green
  '#f06d6f', // red
  '#c48fb6', // purple
  '#e3bb45', // mustard
  '#76c3bc', // teal
  '#b88d72', // brown
  '#ffa6b6', // pink
  '#a6cdee', // light blue
  '#c2c23a', // olive
  '#8b8ee6', // indigo
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
