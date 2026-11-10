import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Layers3, Tags } from 'lucide-react';
import { trendTextClass } from '@shared/lib/amount-color';
import { EChart } from '@shared/ui/echart';
import { treemapSeriesBase } from '@shared/lib/charts/treemap';
import {
  buildDimensionTotals,
  buildFlowGraph,
  buildTrendSeries,
  type AnalyticsTxn,
  type FlowSpendingDimension,
} from '../analytics-model';
import type { AnalyticsData } from '../useAnalyticsData';
import {
  inkOnFill,
  longMonthLabel,
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { KeyFigures, ReportLayout, ViewSwitch } from '../components/ReportLayout';
import { BreakdownTable } from '../components/LedgerTable';
import { reportMeta } from '../report-questions';
import { flowAnswer } from '../report-answers';
import { formatPercent } from '../format-percent';

const MAX_DESTINATIONS = 8;

type FlowDrilldown = { kind: 'other' } | { kind: 'group'; name: string };

interface FlowReportProps {
  data: AnalyticsData;
  /** Month axis of the period; drives the table's trend sparklines. */
  months?: string[];
}

const NO_MONTHS: string[] = [];

/** Monthly spending per destination name (names, not ids, like the graph). */
function trendsByName(
  txns: AnalyticsTxn[],
  months: string[],
  dimension: 'group' | 'category',
  onBudgetAccountIds: Set<number>
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  if (months.length < 2) return map;
  for (const series of buildTrendSeries(
    txns,
    months,
    dimension,
    onBudgetAccountIds,
    Number.MAX_SAFE_INTEGER
  )) {
    const name = series.name.trim();
    const existing = map.get(name);
    map.set(
      name,
      existing ? existing.map((value, index) => value + series.values[index]) : series.values
    );
  }
  return map;
}

/** Container width, so the vertical Sankey can size its node labels. */
function useElementWidth() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  return [ref, width] as const;
}

export function FlowReport({ data, months = NO_MONTHS }: FlowReportProps) {
  const { t } = useLingui();

  const [dimension, setDimension] = useState<FlowSpendingDimension>('group');
  const [drilldown, setDrilldown] = useState<FlowDrilldown | null>(null);
  const palette = usePalette();
  const money = useMoneyFormatters();

  const collapsedGraph = useMemo(
    () => buildFlowGraph(data.txns, data.onBudgetAccountIds, MAX_DESTINATIONS, dimension),
    [data.txns, data.onBudgetAccountIds, dimension]
  );
  const graph = collapsedGraph;
  const nodeLabels = useMemo(() => {
    const systemLabels = {
      income: t`Income`,
      saved: t`Savings`,
      'from-savings': t`From savings`,
      'other-spending': t`Other spending`,
    };
    return new Map(
      graph.nodes.map((node) => [
        node.name,
        node.systemLabel ? systemLabels[node.systemLabel] : node.name.trim(),
      ])
    );
  }, [graph.nodes, t]);

  const net = graph.totalIncome - graph.totalSpending;
  const savingsRate = graph.totalIncome > 0 ? (net / graph.totalIncome) * 100 : null;
  const isEmpty = graph.links.length === 0;
  // Whole phrases per kind: word order and plurals differ between languages.
  const countOf = (kind: 'group' | 'category', count: number) =>
    kind === 'group'
      ? plural(count, { one: '# group', other: '# groups' })
      : plural(count, { one: '# category', other: '# categories' });

  // Node colors by role: income sources cycle the cool half of the palette,
  // spending groups the fixed slot order; results use the status pair.
  const nodeColors = useMemo(() => {
    const colors = new Map<string, string>();
    let incomeIndex = 0;
    let destinationIndex = 0;
    for (const node of graph.nodes) {
      switch (node.slot) {
        case 'hub':
          colors.set(node.name, palette.series[0]);
          break;
        case 'income':
          colors.set(
            node.name,
            node.name.trimEnd() === 'From savings'
              ? palette.flow.negative
              : palette.series[(incomeIndex++ % 4) + 4]
          );
          break;
        case 'group':
          colors.set(
            node.name,
            node.name.trim() === 'Other spending'
              ? palette.chrome.other
              : palette.series[destinationIndex++ % palette.series.length]
          );
          break;
        case 'result':
          colors.set(node.name, palette.flow.positive);
          break;
      }
    }
    return colors;
  }, [graph.nodes, palette]);

  const otherRows = useMemo(
    () =>
      collapsedGraph.foldedDestinations.map((destination, index) => ({
        ...destination,
        key: `other:${destination.name}:${index}`,
        color: palette.series[index % palette.series.length],
      })),
    [collapsedGraph.foldedDestinations, palette.series]
  );

  const groupCategoryRows = useMemo(() => {
    if (drilldown?.kind !== 'group') return [];
    return buildDimensionTotals(
      data.txns.filter((txn) => txn.groupName === drilldown.name),
      'category',
      data.onBudgetAccountIds
    ).map((category, index) => ({
      key: category.key,
      name: category.name,
      value: category.total,
      color: palette.series[index % palette.series.length],
    }));
  }, [data.onBudgetAccountIds, data.txns, drilldown, palette.series]);

  const drilldownRows = drilldown?.kind === 'group' ? groupCategoryRows : otherRows;
  const showingDrilldown = drilldown !== null && drilldownRows.length > 0;
  const drilldownTitle = drilldown?.kind === 'group' ? drilldown.name : t`Other spending`;
  const drilldownItemKind: 'group' | 'category' =
    drilldown?.kind === 'group' || dimension !== 'group' ? 'category' : 'group';

  const drillableGroupNames = useMemo(
    () =>
      new Set(
        graph.nodes
          .filter((node) => node.slot === 'group' && node.name.trim() !== 'Other spending')
          .map((node) => node.name.trim())
      ),
    [graph.nodes]
  );

  const destinationRows = useMemo(() => {
    if (showingDrilldown) return drilldownRows;

    return graph.links
      .filter((link) => link.source === 'Income')
      .map((link) => ({
        key: `destination:${link.target}`,
        name: link.target.trim(),
        label: nodeLabels.get(link.target) ?? link.target.trim(),
        value: link.value,
        color: nodeColors.get(link.target) ?? palette.chrome.other,
      }))
      .sort((a, b) => b.value - a.value);
  }, [drilldownRows, graph.links, nodeColors, nodeLabels, palette.chrome.other, showingDrilldown]);

  const destinationTrends = useMemo(
    () => trendsByName(data.txns, months, dimension, data.onBudgetAccountIds),
    [data.txns, months, dimension, data.onBudgetAccountIds]
  );
  const drilldownTrends = useMemo(
    () =>
      drilldown?.kind === 'group'
        ? trendsByName(
            data.txns.filter((txn) => txn.groupName === drilldown.name),
            months,
            'category',
            data.onBudgetAccountIds
          )
        : destinationTrends,
    [data.txns, months, drilldown, data.onBudgetAccountIds, destinationTrends]
  );
  const otherTrend = useMemo(() => {
    if (months.length < 2) return undefined;
    return months.map((_, index) =>
      collapsedGraph.foldedDestinations.reduce(
        (sum, destination) => sum + (destinationTrends.get(destination.name.trim())?.[index] ?? 0),
        0
      )
    );
  }, [months, collapsedGraph.foldedDestinations, destinationTrends]);
  const systemLabelByName = useMemo(
    () => new Map(graph.nodes.map((node) => [node.name, node.systemLabel])),
    [graph.nodes]
  );

  const [chartRef, chartWidth] = useElementWidth();
  // Widest layer decides how much room each bottom label gets; when that
  // is too tight (phones, many categories) labels turn to read downwards.
  const widestLayer = Math.max(
    1,
    graph.nodes.filter((node) => node.slot === 'group' || node.slot === 'result').length,
    graph.nodes.filter((node) => node.slot === 'income').length
  );
  const labelWidth = Math.max(40, Math.floor((chartWidth || 960) / widestLayer) - 12);
  const rotateLabels = labelWidth < 72;

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    if (showingDrilldown) {
      const drilldownTotal = drilldownRows.reduce((sum, row) => sum + row.value, 0);
      return {
        tooltip: {
          ...tooltipBase(chrome),
          trigger: 'item' as const,
          formatter: (params: unknown) => {
            const item = params as {
              name: string;
              value: number;
              data: { itemStyle?: { color?: string } };
            };
            const value = Math.round(item.value * 1000);
            return tooltipHtml(t`Inside ${drilldownTitle}`, [
              {
                color: item.data.itemStyle?.color ?? chrome.other,
                name: item.name,
                value: `${money.amount(value)} · ${formatPercent(drilldownTotal > 0 ? (value / drilldownTotal) * 100 : 0, drilldownTotal > 0 ? 1 : 0)}`,
              },
            ]);
          },
        },
        series: [
          {
            ...treemapSeriesBase(chrome),
            label: {
              ...treemapSeriesBase(chrome).label,
              formatter: (params: { name: string }) => params.name,
            },
            data: drilldownRows.map((row) => ({
              name: row.name,
              value: row.value / 1000,
              itemStyle: { color: row.color },
              label: { color: inkOnFill(row.color) },
              cursor: drilldown?.kind === 'other' && dimension === 'group' ? 'pointer' : 'default',
            })),
          },
        ],
      };
    }

    return {
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const item = params as {
            dataType: string;
            name: string;
            value: number;
            data: { source?: string; target?: string };
          };
          if (item.dataType === 'edge') {
            return tooltipHtml(t`Flow`, [
              {
                color: nodeColors.get(item.data.target ?? '') ?? chrome.other,
                name: `${nodeLabels.get(item.data.source ?? '') ?? ''} → ${nodeLabels.get(item.data.target ?? '') ?? ''}`,
                value: money.amount(Math.round(item.value * 1000)),
              },
            ]);
          }
          return tooltipHtml(t`Total`, [
            {
              color: nodeColors.get(item.name) ?? chrome.other,
              name: nodeLabels.get(item.name) ?? item.name.trim(),
              value: money.amount(Math.round(item.value * 1000)),
            },
          ]);
        },
      },
      series: [
        {
          type: 'sankey',
          orient: 'vertical' as const,
          left: 8,
          right: 8,
          top: 26,
          bottom: rotateLabels ? 112 : 40,
          nodeWidth: 12,
          nodeGap: 10,
          draggable: false,
          // Slivers' labels would collide; the table below names every node.
          labelLayout: { hideOverlap: true },
          emphasis: { focus: 'adjacency' as const },
          lineStyle: { color: 'gradient' as const, opacity: 0.25, curveness: 0.5 },
          itemStyle: { borderWidth: 0 },
          label: {
            color: chrome.inkPrimary,
            fontSize: 12,
            position: 'bottom' as const,
            width: rotateLabels ? 104 : labelWidth,
            rotate: rotateLabels ? -90 : 0,
            align: rotateLabels ? ('left' as const) : ('center' as const),
            overflow: 'truncate',
            formatter: (params: { name: string }) =>
              nodeLabels.get(params.name) ?? params.name.trim(),
          },
          data: graph.nodes.map((node) => ({
            name: node.name,
            itemStyle: { color: nodeColors.get(node.name) },
            // Sources sit on the top edge (label above), the hub spans the
            // width (label inside), destinations read along the bottom.
            ...(node.slot === 'income'
              ? { label: { position: 'top' as const, rotate: 0, align: 'center' as const } }
              : node.slot === 'hub'
                ? {
                    label: {
                      position: 'inside' as const,
                      rotate: 0,
                      align: 'center' as const,
                      color: inkOnFill(nodeColors.get(node.name) ?? chrome.other),
                    },
                  }
                : {}),
            cursor:
              node.slot === 'group' &&
              (dimension === 'group' || node.name.trim() === 'Other spending')
                ? 'pointer'
                : 'default',
          })),
          links: graph.links.map((link) => ({
            source: link.source,
            target: link.target,
            value: link.value / 1000,
          })),
        },
      ],
    };
  }, [
    dimension,
    drilldown,
    drilldownRows,
    drilldownTitle,
    graph,
    money,
    nodeColors,
    nodeLabels,
    palette,
    t,
    showingDrilldown,
    labelWidth,
    rotateLabels,
  ]);

  const tableRows = destinationRows.map((row) => {
    const isOther = !showingDrilldown && row.name === 'Other spending';
    const systemLabel = showingDrilldown
      ? undefined
      : systemLabelByName.get(row.key.slice('destination:'.length));
    const isDrillableGroup =
      dimension === 'group' &&
      !systemLabel &&
      (showingDrilldown ? drilldown?.kind === 'other' : drillableGroupNames.has(row.name));
    return {
      key: row.key,
      name: isOther
        ? t`Other spending (${countOf(dimension === 'group' ? 'group' : 'category', collapsedGraph.foldedDestinations.length)})`
        : 'label' in row
          ? row.label
          : row.name,
      amount: row.value,
      color: row.color,
      trend: isOther
        ? otherTrend
        : systemLabel
          ? undefined
          : (showingDrilldown ? drilldownTrends : destinationTrends).get(row.name),
      onSelect: isOther
        ? () => setDrilldown({ kind: 'other' })
        : isDrillableGroup
          ? () => setDrilldown({ kind: 'group', name: row.name })
          : undefined,
    };
  });
  const tableTotal = destinationRows.reduce((sum, row) => sum + row.value, 0);
  const fmt = { money: (milli: number) => money.amount(milli), monthLabel: longMonthLabel };

  return (
    <ReportLayout
      question={reportMeta('money-map').question}
      answer={flowAnswer({ income: graph.totalIncome, spending: graph.totalSpending }, fmt)}
      toolbar={
        <>
          <ViewSwitch
            label={t`Destinations`}
            value={dimension}
            onChange={(nextDimension) => {
              setDimension(nextDimension);
              setDrilldown(null);
            }}
            options={[
              { value: 'group', label: t`Groups`, icon: Layers3 },
              { value: 'category', label: t`Categories`, icon: Tags },
            ]}
          />
          {showingDrilldown ? (
            <button
              type="button"
              onClick={() => setDrilldown(null)}
              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Trans>← Back to Money Map</Trans>
            </button>
          ) : null}
        </>
      }
      chart={
        <div ref={chartRef}>
          <EChart
            option={option}
            ariaLabel={
              showingDrilldown
                ? drilldownItemKind === 'group'
                  ? t`${drilldownTitle}: breakdown by group`
                  : t`${drilldownTitle}: breakdown by category`
                : t`Income to spending flow`
            }
            className={showingDrilldown ? 'h-[440px]' : rotateLabels ? 'h-[560px]' : 'h-[500px]'}
            onMarkClick={(mark) => {
              const selectedName = mark.name?.trim();
              if (!selectedName) return;

              if (drilldown?.kind === 'other' && dimension === 'group') {
                if (otherRows.some((row) => row.name === selectedName)) {
                  setDrilldown({ kind: 'group', name: selectedName });
                }
                return;
              }

              const selectedNode = graph.nodes[mark.dataIndex];
              if (
                !selectedNode ||
                selectedNode.slot !== 'group' ||
                selectedNode.name !== mark.name
              ) {
                return;
              }
              if (selectedName === 'Other spending') {
                setDrilldown({ kind: 'other' });
              } else if (dimension === 'group') {
                setDrilldown({ kind: 'group', name: selectedName });
              }
            }}
          />
        </div>
      }
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText={t`No income or spending to map in this period.`}
      figures={
        <KeyFigures
          items={[
            { label: t`Income`, value: money.tile(graph.totalIncome) },
            {
              label: t`Spending`,
              value: money.tile(graph.totalSpending),
              valueClassName:
                graph.totalSpending > 0 ? 'text-red-600 dark:text-red-300' : undefined,
            },
            {
              label: net >= 0 ? t`Savings` : t`Overspent`,
              value: money.tile(Math.abs(net)),
              valueClassName: trendTextClass(net),
            },
            {
              label: t`Savings rate`,
              value: savingsRate === null ? '—' : formatPercent(savingsRate),
              valueClassName: savingsRate !== null ? trendTextClass(savingsRate) : undefined,
            },
          ]}
        />
      }
    >
      {isEmpty ? null : (
        <BreakdownTable
          title={
            showingDrilldown
              ? t`Inside ${drilldownTitle} · ${countOf(drilldownItemKind, drilldownRows.length)}`
              : dimension === 'group'
                ? t`Destination groups`
                : t`Destination categories`
          }
          nameHeader={t`Name`}
          rows={tableRows}
          total={tableTotal}
          money={money.amount}
          showTrend={months.length >= 2}
          maxHeightClassName={showingDrilldown ? 'max-h-[420px]' : undefined}
        />
      )}
    </ReportLayout>
  );
}
