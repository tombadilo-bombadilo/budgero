/**
 * Series logic shared by the bar / line / area / pie chart and the row
 * chart: colours past the fixed palette, legend toggling that survives a
 * changed result, stacking shares and drill-through values.
 */
import { useCallback, useMemo, useState } from 'react';
import type { DrillValue, ResolvedStacking } from '@features/reports/lib/question';
import { OTHER_SERIES_ID, type ChartModel, type ChartSeries } from '../chart-model';
import { isOther } from './transforms';

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function parseRgb(color: string): [number, number, number] | null {
  const hex = parseHex(color);
  if (hex) return hex;
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function toHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1
      ? [chroma, second, 0]
      : segment < 2
        ? [second, chroma, 0]
        : segment < 3
          ? [0, chroma, second]
          : segment < 4
            ? [0, second, chroma]
            : segment < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value + offset)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/**
 * Colour of the series at `position`. The first pass uses the validated
 * palette as is; every further pass shifts its hue and alternates lighter /
 * darker, so no two series of one chart share a colour.
 */
export function seriesColor(palette: readonly string[], position: number): string {
  const base = palette[position % palette.length];
  const pass = Math.floor(position / palette.length);
  if (pass === 0) return base;
  const rgb = parseHex(base);
  if (!rgb) return base;
  const [hue, saturation, lightness] = toHsl(rgb);
  const step = Math.ceil(pass / 2);
  const shifted = pass % 2 === 1 ? lightness + 0.17 * step : lightness - 0.15 * step;
  return toHex(
    hue + 22 * pass,
    Math.max(0.35, saturation - 0.08 * step),
    Math.min(0.82, Math.max(0.22, shifted))
  );
}

function luminance([r, g, b]: [number, number, number]): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#18181b';

/** White or near-black, whichever reads better on `background`. */
export function readableTextOn(background: string): string {
  const rgb = parseRgb(background);
  if (!rgb) return LIGHT_TEXT;
  const level = luminance(rgb);
  const onLight = (1 + 0.05) / (level + 0.05);
  const onDark = (level + 0.05) / (luminance([24, 24, 27]) + 0.05);
  return onLight >= onDark ? LIGHT_TEXT : DARK_TEXT;
}

// ---------------------------------------------------------------------------
// Legend toggling
// ---------------------------------------------------------------------------

/** Toggle helper: never hides the last visible item. */
export function toggleHidden(previous: Set<string>, id: string, total: number): Set<string> {
  const next = new Set(previous);
  if (next.has(id)) next.delete(id);
  else if (total - next.size > 1) next.add(id);
  return next;
}

/**
 * Hidden ids that still exist. A new result can drop or rename series; ids
 * left over from the old one must not hide everything.
 */
export function pruneHidden(hidden: Set<string>, ids: readonly string[]): Set<string> {
  if (hidden.size === 0) return hidden;
  const known = new Set(ids);
  const kept = new Set(Array.from(hidden).filter((id) => known.has(id)));
  return kept.size >= known.size ? new Set() : kept;
}

/** Legend state for the given series ids; always leaves one visible. */
export function useHiddenSeries(ids: readonly string[]): {
  hidden: Set<string>;
  toggle: (id: string) => void;
} {
  const [raw, setRaw] = useState<Set<string>>(new Set());
  // Compared by content: a new array with the same ids keeps the state.
  const signature = ids.join('\u0000');
  const stable = useMemo(() => (signature === '' ? [] : signature.split('\u0000')), [signature]);
  const hidden = useMemo(() => pruneHidden(raw, stable), [raw, stable]);
  const toggle = useCallback(
    (id: string) =>
      setRaw((previous) => toggleHidden(pruneHidden(previous, stable), id, stable.length)),
    [stable]
  );
  return { hidden, toggle };
}

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

export interface SeriesLayout {
  /** Series the legend has not hidden, with their position (colour slot). */
  visible: { series: ChartSeries; position: number }[];
  stack: boolean;
  /** Stacked to 100%: `plotted` returns shares (0..100). */
  percent: boolean;
  plotted: (values: number[]) => number[];
  /** A value's share (0..1) of its x value's visible total. */
  share: (value: number, index: number) => number;
}

export function layoutSeries(
  model: ChartModel,
  hidden: Set<string>,
  stacking: ResolvedStacking
): SeriesLayout {
  const visible = model.series
    .map((series, position) => ({ series, position }))
    .filter(({ series }) => !hidden.has(series.id));
  const stack = stacking !== 'none' && visible.length > 1;
  const percent = stack && stacking === 'percent';
  const totals = model.xValues.map((_, index) =>
    visible.reduce((sum, { series }) => sum + Math.abs(series.values[index] ?? 0), 0)
  );
  const share = (value: number, index: number) =>
    totals[index] > 0 ? Math.abs(value ?? 0) / totals[index] : 0;
  return {
    visible,
    stack,
    percent,
    plotted: (values) =>
      percent ? values.map((value, index) => share(value, index) * 100) : values,
    share,
  };
}

// ---------------------------------------------------------------------------
// Drill-through
// ---------------------------------------------------------------------------

/**
 * What a clicked mark stands for: its x value and, with a second grouping,
 * its series value. Null when the mark is a folded "Other" bucket (it is
 * many values at once) or nothing drillable.
 */
export function markDrillValues(
  model: ChartModel,
  position: number,
  seriesId?: string
): DrillValue[] | null {
  if (!model.x || model.x.kind !== 'breakout') return null;
  if (position < 0 || position >= model.xValues.length) return null;
  if (isOther(model.xValues[position])) return null;
  const key = model.xKeys[position];
  const values: DrillValue[] = [
    { column: model.x, value: model.xValues[position], ...(key !== undefined ? { key } : {}) },
  ];
  const series = model.series.find((item) => item.id === seriesId);
  if (model.seriesColumn?.kind === 'breakout' && series) {
    if (series.id === OTHER_SERIES_ID) return values;
    values.push({
      column: model.seriesColumn,
      value: series.groupValue,
      ...(series.groupKey !== undefined ? { key: series.groupKey } : {}),
    });
  }
  return values;
}
