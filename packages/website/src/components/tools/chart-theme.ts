'use client';

import { useMemo, useSyncExternalStore } from 'react';

/**
 * Chart colours for the website tools, matching the app's analytics charts
 * (packages/app/src/shared/lib/charts/palette.ts). Series colours are the
 * app's validated colour-blind-safe slots; the chrome (surface, ink, muted
 * text) is read from the website's own theme tokens so the chart sits on the
 * card it is drawn in. Kept free of echarts imports so the calculators can
 * build options without pulling the chart library into their first load.
 */

export interface ChartPalette {
  dark: boolean;
  /** Blue: app series slot 1. */
  blue: string;
  /** Orange: app series slot 6. Blue/orange stays distinct under every CVD type. */
  orange: string;
  surface: string;
  grid: string;
  axisLine: string;
  axisText: string;
  ink: string;
}

const LIGHT: ChartPalette = {
  dark: false,
  blue: '#2a78d6',
  orange: '#eb6834',
  surface: '#fffdf8',
  grid: '#e9e9ec',
  axisLine: '#d4d4d8',
  axisText: '#64748b',
  ink: '#141414',
};

const DARK: ChartPalette = {
  dark: true,
  blue: '#3987e5',
  orange: '#d95926',
  surface: '#1e293b',
  grid: 'rgba(255, 255, 255, 0.08)',
  axisLine: 'rgba(255, 255, 255, 0.18)',
  axisText: '#94a3b8',
  ink: '#f8fafc',
};

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains('dark');

/** Hex/rgb tokens only: zrender cannot parse oklch() and drops the mark on hover. */
function readToken(styles: CSSStyleDeclaration, name: string, fallback: string) {
  const raw = styles.getPropertyValue(name).trim();
  return /^(#|rgba?\()/i.test(raw) ? raw : fallback;
}

/** The palette for the active theme; re-renders when the `dark` class flips. */
export function useChartPalette(): ChartPalette {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return useMemo(() => {
    const base = dark ? DARK : LIGHT;
    if (typeof window === 'undefined') return base;
    const styles = getComputedStyle(document.documentElement);
    return {
      ...base,
      surface: readToken(styles, '--card', base.surface),
      axisText: readToken(styles, '--muted-foreground', base.axisText),
      ink: readToken(styles, '--foreground', base.ink),
    };
  }, [dark]);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tooltip box styling shared with the app's charts. */
export function tooltipBase(palette: ChartPalette) {
  return {
    backgroundColor: palette.surface,
    borderColor: palette.dark ? palette.axisLine : palette.grid,
    borderWidth: 1,
    padding: [8, 12],
    confine: true,
    textStyle: { color: palette.ink, fontSize: 12, fontFamily: 'inherit' },
    extraCssText: 'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);',
  };
}

export interface TooltipRow {
  color: string;
  name: string;
  value: string;
}

/** Value-first rows keyed with a short series-colour stroke, as in the app. */
export function tooltipHtml(title: string, rows: TooltipRow[]) {
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

/** Hairline gridlines, muted labels, no axis line: the app's value axis. */
export function valueAxis(palette: ChartPalette, format: (value: number) => string) {
  return {
    type: 'value' as const,
    axisLabel: { color: palette.axisText, fontSize: 11, formatter: format },
    splitLine: { lineStyle: { color: palette.grid, width: 1 } },
    axisLine: { show: false },
    axisTick: { show: false },
  };
}

export const BASE_GRID = { left: 8, right: 16, top: 16, bottom: 4, containLabel: true };
