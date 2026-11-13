import { i18n } from '@lingui/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages as germanMessages } from '../../../locales/de/messages.mjs';

import type { AnalyticsTxn } from '../analytics-model';
import type { AnalyticsData } from '../useAnalyticsData';
import { SpendingReport } from './SpendingReport';

const chartState = vi.hoisted(() => ({
  option: null as unknown,
}));

vi.mock('@shared/ui/echart', () => ({
  EChart: ({ option, onMarkClick }: { option: unknown; onMarkClick?: (mark: unknown) => void }) => {
    chartState.option = option;
    return (
      <button
        type="button"
        onClick={() => {
          const series = (option as { series: { name: string }[] }).series;
          onMarkClick?.({ seriesName: series[series.length - 1].name, dataIndex: 0, value: 0 });
        }}
      >
        Select Other
      </button>
    );
  },
}));

vi.mock('@shared/ui/animated-number', () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

vi.mock('../components/chart-utils', () => ({
  BASE_GRID: {},
  BAR_MAX_WIDTH: 32,
  inkOnFill: () => '#ffffff',
  monthAxis: () => ({}),
  moneyAxis: () => ({}),
  shortMonthLabel: (month: string) => month,
  longMonthLabel: (month: string) => month,
  tooltipBase: () => ({}),
  tooltipHtml: () => '',
  useMoneyFormatters: () => ({
    amount: (value: number) => String(value),
    compact: (value: number) => String(value),
    tile: (value: number) => String(value),
    masked: false,
  }),
  usePalette: () => ({
    series: ['#1d4ed8', '#0f766e', '#a16207', '#be123c', '#6d28d9', '#0369a1', '#4d7c0f'],
    chrome: {
      surface: '#ffffff',
      grid: '#d4d4d8',
      axisLine: '#d4d4d8',
      axisText: '#52525b',
      inkPrimary: '#18181b',
      inkSecondary: '#52525b',
      other: '#71717a',
    },
    flow: { positive: '#15803d', negative: '#b91c1c' },
  }),
}));

function transaction(index: number): AnalyticsTxn {
  return {
    id: index,
    date: '2026-08-01',
    monthKey: '2026-08',
    accountId: 1,
    categoryId: index,
    category: `Category ${index}`,
    groupName: 'Spending',
    payee: '',
    labelId: null,
    label: '',
    labelColor: null,
    inflow: 0,
    outflow: (11 - index) * 10_000,
    isTransfer: false,
    isIncome: false,
  };
}

function chartSeries(): { name: string; color: string }[] {
  const option = chartState.option as {
    series: { name: string; itemStyle: { color: string } }[];
  };
  return option.series.map((series) => ({
    name: series.name,
    color: series.itemStyle.color,
  }));
}

describe('SpendingReport', () => {
  afterEach(() => {
    cleanup();
    i18n.activate('en');
  });
  it.each(['en', 'de'])('expands the translated Other bucket from the chart (%s)', (locale) => {
    i18n.load('de', germanMessages);
    i18n.activate(locale);
    const otherLabel = locale === 'de' ? 'Sonstige' : 'Other';
    const data: AnalyticsData = {
      budgetId: 1,
      isLoading: false,
      allTxns: [],
      txns: Array.from({ length: 10 }, (_, index) => transaction(index + 1)),
      accounts: [],
      onBudgetAccountIds: new Set([1]),
      categories: [],
      categoryGroups: [],
      labels: [],
      payees: [],
    };

    render(<SpendingReport data={data} months={['2026-08']} />);

    expect(chartSeries()).toHaveLength(9);
    expect(chartSeries()).toContainEqual({ name: otherLabel, color: '#71717a' });
    expect(screen.queryByText('Category 10')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select Other' }));

    expect(chartSeries()).toHaveLength(10);
    expect(chartSeries().some((series) => series.name === otherLabel)).toBe(false);
    expect(chartSeries().find((series) => series.name === 'Category 10')?.color).not.toBe(
      '#71717a'
    );
    expect(screen.getByText('Category 10')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: locale === 'de' ? '← Sonstige einklappen' : '← Collapse Other',
      })
    ).toBeInTheDocument();
  });

  it('answers the question and expands Other from the breakdown table', () => {
    const data: AnalyticsData = {
      budgetId: 1,
      isLoading: false,
      allTxns: [],
      txns: Array.from({ length: 10 }, (_, index) => transaction(index + 1)),
      accounts: [],
      onBudgetAccountIds: new Set([1]),
      categories: [],
      categoryGroups: [],
      labels: [],
      payees: [],
    };

    render(<SpendingReport data={data} months={['2026-07', '2026-08']} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Where does my money go?');
    expect(screen.getByTestId('report-answer')).toHaveTextContent(
      'You spent 550000 since 2026-07 — Category 1 took the most (18%).'
    );
    const table = screen.getByRole('table');
    // 8 named rows + Other; header row on top.
    expect(within(table).getAllByRole('row')).toHaveLength(10);
    expect(within(table).getAllByTestId('sparkline')).toHaveLength(9);

    const other = within(table).getByRole('button', { name: 'Other (2 more)' });
    expect(other).not.toHaveAttribute('aria-expanded');
    fireEvent.click(other);

    expect(within(table).getAllByRole('row')).toHaveLength(11);
    expect(within(table).getByText('Category 10')).toBeInTheDocument();
    expect(chartSeries()).toHaveLength(10);

    fireEvent.click(screen.getByRole('button', { name: '← Collapse Other' }));
    expect(within(screen.getByRole('table')).queryByText('Category 10')).not.toBeInTheDocument();
  });
});
