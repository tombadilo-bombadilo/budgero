/**
 * Theme-aware chrome shared by every ECharts surface (prebuilt analytics,
 * AI chat charts, dashboard widgets, explorer previews): the validated
 * palette resolved for the active theme, plus tooltip scaffolding.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { getPalette, type ChartChrome, type Palette } from './palette';

// 1×1 scratch canvas used as a universal color parser via PIXEL READBACK.
// The fillStyle getter is useless for this in modern Chrome — it echoes
// oklch()/lab() strings back verbatim instead of serializing to hex — so we
// paint the color and read the actual pixel.
let scratchContext: CanvasRenderingContext2D | null | undefined;
function getScratchContext(): CanvasRenderingContext2D | null {
  if (scratchContext === undefined) {
    if (typeof document === 'undefined') {
      scratchContext = null;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      scratchContext = canvas.getContext('2d', { willReadFrequently: true });
    }
  }
  return scratchContext;
}

const SENTINEL = '#010203';

/**
 * Normalize a CSS color to rgb/rgba. ECharts' internal color engine
 * (zrender) parses colors itself for hover/animation states, and it only
 * understands hex/rgb/hsl — an `oklch(...)` token paints fine initially but
 * the mark VANISHES on hover when that parse fails. Every theme-derived
 * color must pass through here before entering a chart option. Returns null
 * for values the browser itself can't parse.
 */
function normalizeColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || /^rgba?\(/i.test(trimmed) || /^hsla?\(/i.test(trimmed)) {
    return trimmed;
  }
  const context = getScratchContext();
  if (!context) return trimmed;
  // An invalid assignment leaves the previous fillStyle (the sentinel) in
  // place; clearRect first so translucent colors don't composite over it.
  context.fillStyle = SENTINEL;
  context.fillStyle = trimmed;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  const isSentinel = r === 1 && g === 2 && b === 3 && a === 255;
  if (isSentinel && trimmed.toLowerCase() !== SENTINEL) return null;
  return a === 255
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

/**
 * Chart chrome follows the ACTIVE THEME PRESET, not just light/dark: the
 * surface/grid/ink roles are read from the live CSS tokens each preset
 * defines (Phosphor's green ink, Mesa's desert tones, Paper's parchment).
 * The static hexes in palette.ts remain the fallback. Series colors stay
 * the validated fixed palette — those carry data identity, not branding.
 */
function readThemedChrome(fallback: ChartChrome): ChartChrome {
  if (typeof window === 'undefined') return fallback;
  const styles = getComputedStyle(document.documentElement);
  const read = (token: string, fallbackValue: string) => {
    const raw = styles.getPropertyValue(token).trim();
    return (raw && normalizeColor(raw)) || fallbackValue;
  };
  return {
    surface: read('--card', fallback.surface),
    grid: read('--border', fallback.grid),
    axisLine: read('--border', fallback.axisLine),
    axisText: read('--muted-foreground', fallback.axisText),
    inkPrimary: read('--foreground', fallback.inkPrimary),
    inkSecondary: read('--muted-foreground', fallback.inkSecondary),
    other: fallback.other,
  };
}

export function useChartPalette(): Palette {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  // Theme presets and the Classic font stamp attributes on <html>; watching
  // them keeps chart chrome (and the host's font re-read) in sync without
  // coupling to the ThemePreset context.
  const [themeStamp, setThemeStamp] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeStamp((stamp) => stamp + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-classic-font'],
    });
    return () => observer.disconnect();
  }, []);

  return useMemo(() => {
    // Read to invalidate the token snapshot on preset/font changes.
    void themeStamp;
    const base = getPalette(dark);
    return { ...base, chrome: readThemedChrome(base.chrome) };
  }, [dark, themeStamp]);
}

const CSS_VAR_PATTERN = /^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/;

/**
 * Resolve a `var(--token)` color to its concrete computed value, normalized
 * to a zrender-parseable hex/rgba form (see normalizeColor). Entity/config
 * colors that may be CSS vars or modern color functions must pass through
 * here before entering a chart option — canvas ignores var() strings and
 * zrender's hover lift chokes on oklch/lab.
 */
export function resolveCssColor(color: string): string {
  const trimmed = color.trim();
  const match = CSS_VAR_PATTERN.exec(trimmed);
  if (typeof window === 'undefined') return trimmed;
  if (!match) {
    return normalizeColor(trimmed) ?? trimmed;
  }
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  const candidate = resolved || match[2]?.trim() || '';
  return (candidate && normalizeColor(candidate)) || trimmed;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Shared tooltip container styling (HTML tooltips; all content must be escaped). */
export function tooltipBase(chrome: ChartChrome) {
  return {
    backgroundColor: chrome.surface,
    borderColor: chrome.grid,
    borderWidth: 1,
    padding: [8, 12],
    // 'inherit' picks up the app typeface (HTML tooltip inherits from page).
    textStyle: { color: chrome.inkPrimary, fontSize: 12, fontFamily: 'inherit' },
    extraCssText: 'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);',
  };
}

export interface TooltipRow {
  color: string;
  name: string;
  value: string;
}

/** Value-first tooltip rows keyed with a short series-color stroke. */
export function tooltipHtml(title: string, rows: TooltipRow[]): string {
  const body = rows
    .map(
      (row) =>
        `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">` +
        `<span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${row.color};"></span>` +
        `<span style="font-weight:600;">${escapeHtml(row.value)}</span>` +
        `<span style="opacity:0.72;">${escapeHtml(row.name)}</span>` +
        `</div>`
    )
    .join('');
  return `<div style="font-size:12px;opacity:0.72;">${escapeHtml(title)}</div>${body}`;
}

/** White or near-black ink for text set inside a colored fill, by luminance. */
export function inkOnFill(hex: string): string {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.35 ? '#18181b' : '#ffffff';
}

/** Mark specs shared across surfaces: ≤24px bars, 4px rounded data-end. */
export const BAR_MAX_WIDTH = 24;
export const BAR_RADIUS_TOP: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_BOTTOM: [number, number, number, number] = [0, 0, 4, 4];
