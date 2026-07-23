import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { trendTextClass } from '@shared/lib/amount-color';
import { EChart } from '@shared/ui/echart';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { buildFlowGraph } from '../analytics-model';
import type { AnalyticsData } from '../useAnalyticsData';
import {
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { ReportShell } from '../components/ReportShell';
import { PanelSectionTitle, ProportionRow, StatTile } from '../components/panels';

const MAX_GROUPS = 8;

interface FlowReportProps {
  data: AnalyticsData;
}

export function FlowReport({ data }: FlowReportProps) {
  const palette = usePalette();
  const money = useMoneyFormatters();

  const graph = useMemo(
    () => buildFlowGraph(data.txns, data.onBudgetAccountIds, MAX_GROUPS),
    [data.txns, data.onBudgetAccountIds]
  );

  const net = graph.totalIncome - graph.totalSpending;
  const savingsRate = graph.totalIncome > 0 ? (net / graph.totalIncome) * 100 : null;
  const isEmpty = graph.links.length === 0;

  // Node colors by role: income sources cycle the cool half of the palette,
  // spending groups the fixed slot order; results use the status pair.
  const nodeColors = useMemo(() => {
    const colors = new Map<string, string>();
    let incomeIndex = 0;
    let groupIndex = 0;
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
          colors.set(node.name, palette.series[groupIndex++ % palette.series.length]);
          break;
        case 'result':
          colors.set(node.name, palette.flow.positive);
          break;
      }
    }
    return colors;
  }, [graph.nodes, palette]);

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
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
            return tooltipHtml('Flow', [
              {
                color: nodeColors.get(item.data.target ?? '') ?? chrome.other,
                name: `${(item.data.source ?? '').trim()} → ${(item.data.target ?? '').trim()}`,
                value: money.amount(Math.round(item.value * 1000)),
              },
            ]);
          }
          return tooltipHtml('Total', [
            {
              color: nodeColors.get(item.name) ?? chrome.other,
              name: item.name.trim(),
              value: money.amount(Math.round(item.value * 1000)),
            },
          ]);
        },
      },
      series: [
        {
          type: 'sankey',
          left: 8,
          right: 130,
          top: 12,
          bottom: 12,
          nodeWidth: 14,
          nodeGap: 14,
          draggable: false,
          emphasis: { focus: 'adjacency' as const },
          lineStyle: { color: 'gradient' as const, opacity: 0.25, curveness: 0.55 },
          itemStyle: { borderWidth: 0 },
          label: {
            color: chrome.inkPrimary,
            fontSize: 12,
            formatter: (params: { name: string }) => params.name.trim(),
          },
          data: graph.nodes.map((node) => ({
            name: node.name,
            itemStyle: { color: nodeColors.get(node.name) },
          })),
          links: graph.links.map((link) => ({
            source: link.source,
            target: link.target,
            value: link.value / 1000,
          })),
        },
      ],
    };
  }, [graph, nodeColors, palette, money]);

  const groupRows = useMemo(() => {
    const rows = graph.links
      .filter((link) => link.source === 'Income')
      .map((link) => ({
        name: link.target.trim(),
        value: link.value,
        color: nodeColors.get(link.target) ?? palette.chrome.other,
      }))
      .sort((a, b) => b.value - a.value);
    return rows;
  }, [graph.links, nodeColors, palette]);

  const largest = groupRows[0];

  return (
    <ReportShell
      title="Money Map"
      hero={
        <AnimatedNumber
          value={graph.totalIncome}
          formatter={(value) => money.amount(value)}
          rounding="integer"
        />
      }
      subtitle={
        savingsRate === null
          ? 'Every stream from income to destination'
          : `Income → spending; ${savingsRate >= 0 ? `${savingsRate.toFixed(0)}% saved` : `overspent by ${money.amount(-net)}`}`
      }
      chart={<EChart option={option} ariaLabel="Income to spending flow" className="h-[440px]" />}
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText="No income or spending to map in this period."
      panel={
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Income" value={money.tile(graph.totalIncome)} />
            <StatTile
              label="Spending"
              value={money.tile(graph.totalSpending)}
              valueClassName={
                graph.totalSpending > 0 ? 'text-red-600 dark:text-red-300' : undefined
              }
            />
            <StatTile
              label={net >= 0 ? 'Saved' : 'Overspent'}
              value={money.tile(Math.abs(net))}
              valueClassName={trendTextClass(net)}
            />
            <StatTile
              label="Savings rate"
              value={savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
              valueClassName={savingsRate !== null ? trendTextClass(savingsRate) : undefined}
            />
          </div>
          <PanelSectionTitle>Destinations</PanelSectionTitle>
          <div>
            {groupRows.map((row) => (
              <ProportionRow
                key={row.name}
                color={row.color}
                name={row.name}
                value={money.amount(row.value)}
                fraction={largest && largest.value > 0 ? row.value / largest.value : 0}
              />
            ))}
          </div>
        </>
      }
    />
  );
}
