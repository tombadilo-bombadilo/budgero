/**
 * Downloads for questions and dashboard widgets: the result as CSV (friendly
 * headers, raw values so spreadsheets can compute) and the chart as PNG
 * (ECharts' own renderer, with the title drawn above it).
 */
import { getInstanceByDom } from 'echarts/core';
import type { QuestionColumn, QuestionSource } from '@features/reports/lib/question';
import { downloadBlob } from '@shared/lib/download';
import { resultsToCsv } from '@shared/lib/sql/csv';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { columnLabel } from '../question-labels';

const BOM = String.fromCharCode(0xfeff);

/** A file name from a title: no path separators or control characters. */
export function safeFileName(name: string, fallback = 'question'): string {
  const printable = Array.from(name, (char) => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  const cleaned = printable
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

/** CSV of a question result: friendly headers in column order, raw values. */
export function questionResultCsv(
  result: QueryResult,
  columns: QuestionColumn[],
  source: QuestionSource
): string {
  const index = new Map(result.columns.map((name, position) => [name, position]));
  const shown = columns.filter((column) => index.has(column.key));
  if (shown.length === 0) return resultsToCsv(result.columns, result.rows);
  return resultsToCsv(
    shown.map((column) => columnLabel(source, column)),
    result.rows.map((row) => shown.map((column) => row[index.get(column.key)!]))
  );
}

export function downloadCsv(csv: string, name: string): void {
  // BOM so Excel opens UTF-8 names correctly.
  downloadBlob(`${BOM}${csv}`, `${safeFileName(name)}.csv`, 'text/csv;charset=utf-8;');
}

/** ECharts hosts inside a container that can be exported (largest first). */
function chartHosts(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('div[role="img"]'))
    .filter((element) => !element.closest('[data-no-export]') && getInstanceByDom(element))
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
}

export function hasExportableChart(container: HTMLElement | null): boolean {
  return Boolean(container && chartHosts(container).length > 0);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Chart image failed to load'));
    image.src = src;
  });
}

export interface PngLegendEntry {
  label: string;
  color: string;
}

/** The legend shown with the chart (HTML, so ECharts' image lacks it); hidden series left out. */
export function readLegend(container: HTMLElement): PngLegendEntry[] {
  const legend = Array.from(container.querySelectorAll<HTMLElement>('[data-chart-legend]')).find(
    (element) => !element.closest('[data-no-export]')
  );
  if (!legend) return [];
  return Array.from(legend.querySelectorAll<HTMLElement>('[data-legend-label]'))
    .filter((item) => !item.hasAttribute('data-legend-off'))
    .map((item) => ({
      label: item.dataset.legendLabel ?? '',
      color: item.dataset.legendColor ?? '#888888',
    }));
}

export interface LegendPlacement extends PngLegendEntry {
  x: number;
  y: number;
  /** Text width available (long labels are cut to it). */
  width: number;
}

/**
 * Lays legend entries out in wrapping rows: swatch, gap, label, spacing.
 * `measure` gives a label's width; widths are in the caller's units.
 */
export function layoutLegend(
  entries: PngLegendEntry[],
  measure: (text: string) => number,
  maxWidth: number,
  sizes: { swatch: number; gap: number; spacing: number; rowHeight: number; maxLabel: number }
): { items: LegendPlacement[]; height: number } {
  const items: LegendPlacement[] = [];
  let x = 0;
  let y = 0;
  for (const entry of entries) {
    const width = Math.min(measure(entry.label), sizes.maxLabel);
    const total = sizes.swatch + sizes.gap + width;
    if (x > 0 && x + total > maxWidth) {
      x = 0;
      y += sizes.rowHeight;
    }
    items.push({ ...entry, x, y, width: Math.min(width, maxWidth - sizes.swatch - sizes.gap) });
    x += total + sizes.spacing;
  }
  return { items, height: entries.length > 0 ? y + sizes.rowHeight : 0 };
}

/**
 * Saves the container's chart as `<name>.png` on the given background, with
 * the title above it. Returns false when there is no chart to save.
 */
export async function downloadChartPng(
  container: HTMLElement | null,
  name: string,
  colors: { background: string; ink: string }
): Promise<boolean> {
  const host = container ? chartHosts(container)[0] : undefined;
  const chart = host ? getInstanceByDom(host) : undefined;
  if (!host || !chart) return false;
  const pixelRatio = 2;
  const image = await loadImage(
    chart.getDataURL({ type: 'png', pixelRatio, backgroundColor: colors.background })
  );
  const padding = 16 * pixelRatio;
  const titleHeight = name ? 28 * pixelRatio : 0;
  const font = getComputedStyle(host).fontFamily || 'sans-serif';
  const width = image.width + padding * 2;
  const measureCanvas = document.createElement('canvas').getContext('2d');
  const legendFont = `${12 * pixelRatio}px ${font}`;
  if (measureCanvas) measureCanvas.font = legendFont;
  const legend = layoutLegend(
    container ? readLegend(container) : [],
    (text) => measureCanvas?.measureText(text).width ?? text.length * 7 * pixelRatio,
    image.width,
    {
      swatch: 10 * pixelRatio,
      gap: 6 * pixelRatio,
      spacing: 14 * pixelRatio,
      rowHeight: 18 * pixelRatio,
      maxLabel: 220 * pixelRatio,
    }
  );
  const legendHeight = legend.height > 0 ? legend.height + 8 * pixelRatio : 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = image.height + padding * 2 + titleHeight + legendHeight;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.fillStyle = colors.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'top';
  if (name) {
    context.fillStyle = colors.ink;
    context.font = `600 ${15 * pixelRatio}px ${font}`;
    context.fillText(name, padding, padding, canvas.width - padding * 2);
  }
  const legendTop = padding + titleHeight;
  context.font = legendFont;
  context.textBaseline = 'middle';
  for (const item of legend.items) {
    const top = legendTop + item.y;
    const middle = top + 9 * pixelRatio;
    context.fillStyle = item.color;
    context.fillRect(padding + item.x, middle - 5 * pixelRatio, 10 * pixelRatio, 10 * pixelRatio);
    context.fillStyle = colors.ink;
    context.fillText(item.label, padding + item.x + 16 * pixelRatio, middle, item.width);
  }
  context.drawImage(image, padding, padding + titleHeight + legendHeight);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  downloadBlob(blob, `${safeFileName(name, 'chart')}.png`, 'image/png');
  return true;
}
