import { useMemo } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { formatMonthLabel } from '@shared/lib/date-utils';
import type { ChartChrome } from '@shared/lib/charts/palette';
import { useChartPalette } from '@shared/lib/charts/echarts-chrome';

export { useChartPalette as usePalette };
export {
  escapeHtml,
  inkOnFill,
  tooltipBase,
  tooltipHtml,
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  BAR_RADIUS_BOTTOM,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';

export interface MoneyFormatters {
  /** Full masked currency amount from milliunits. */
  amount: (milli: number) => string;
  /** Compact "$4.2K"-style axis label from milliunits. */
  compact: (milli: number) => string;
  /** Stat-tile amount: full when it fits, otherwise "RSD 2.76M"-style. */
  tile: (milli: number) => string;
  masked: boolean;
}

/** Full amounts longer than this switch to compact notation in stat tiles. */
const TILE_MAX_CHARS = 12;

export function useMoneyFormatters(): MoneyFormatters {
  const localizer = useUiStore((state) => state.globalLocalizer);
  const masked = useUiStore((state) => state.privacyMaskNumbers);
  return useMemo(() => {
    const resolved = localizer.resolvedOptions();
    const compactFormat = new Intl.NumberFormat(resolved.locale, {
      style: 'currency',
      currency: resolved.currency ?? 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const tileFormat = new Intl.NumberFormat(resolved.locale, {
      style: 'currency',
      currency: resolved.currency ?? 'USD',
      notation: 'compact',
      maximumFractionDigits: 2,
    });
    const amount = (milli: number) => formatMaskedMilli(localizer, milli, masked);
    return {
      amount,
      compact: (milli: number) => (masked ? '•••' : compactFormat.format(milli / 1000)),
      tile: (milli: number) => {
        const full = amount(milli);
        if (masked || full.length <= TILE_MAX_CHARS) return full;
        return tileFormat.format(milli / 1000);
      },
      masked,
    };
  }, [localizer, masked]);
}

export function shortMonthLabel(monthKey: string): string {
  return formatMonthLabel(monthKey, { month: 'short', year: '2-digit' });
}

/** Category (month) axis with hairline baseline and muted labels. */
export function monthAxis(months: string[], chrome: ChartChrome) {
  return {
    type: 'category' as const,
    data: months.map(shortMonthLabel),
    axisLine: { lineStyle: { color: chrome.axisLine } },
    axisTick: { show: false },
    axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
  };
}

/** Value axis: hairline solid gridlines, compact currency ticks, no axis line. */
export function moneyAxis(chrome: ChartChrome, compact: (milli: number) => string) {
  return {
    type: 'value' as const,
    axisLabel: {
      color: chrome.axisText,
      fontSize: 11,
      formatter: (value: number) => compact(value * 1000),
    },
    splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
    axisLine: { show: false },
  };
}

export const BASE_GRID = { left: 8, right: 12, top: 16, bottom: 4, containLabel: true };
