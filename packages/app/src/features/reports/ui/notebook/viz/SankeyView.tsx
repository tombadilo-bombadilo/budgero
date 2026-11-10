import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useRef } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { buildSankey, DEFAULT_SANKEY_TOP_N, isOther, type SankeyNode } from './transforms';
import { seriesColor } from './series';
import type { VizViewProps } from './types';
import { labelWidthFor, useElementWidth } from './useElementWidth';

/**
 * Flows from the first grouping to the second (e.g. category group →
 * category, account → category group), weighted by the first metric. Each
 * side keeps its largest values; the rest flow through "Other".
 */
export function SankeyView({
  result,
  columns,
  source,
  display,
  fitHeight,
  className,
}: VizViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source, result);
  const data = useMemo(
    () => buildSankey(result, columns, display?.topN ?? DEFAULT_SANKEY_TOP_N),
    [result, columns, display?.topN]
  );
  // Labels sit right of the last column: their room shrinks on narrow screens.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelWidth = labelWidthFor(useElementWidth(hostRef, 600), 180);

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!data || data.links.length === 0) return null;
    const { chrome } = palette;
    const [leftOther, rightOther] = data.otherCounts;
    const nodeName = (node: SankeyNode, style: 'short' | 'long' = 'short') => {
      if (isOther(node.value)) {
        const count = node.level === 0 ? leftOther : rightOther;
        return t`Other (${count})`;
      }
      return format.cell(node.level === 0 ? data.from : data.to, node.value, style);
    };
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    let colorSlot = 0;
    const colorOf = new Map<string, string>();
    for (const node of data.nodes) {
      colorOf.set(
        node.id,
        isOther(node.value) ? chrome.other : seriesColor(palette.series, colorSlot++)
      );
    }
    const metricLabel = columnLabel(source, data.metric);
    return {
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const item = params as {
            dataType: 'node' | 'edge';
            data: { name?: string; source?: string; target?: string; value: number };
          };
          if (item.dataType === 'edge') {
            const from = byId.get(item.data.source ?? '');
            const to = byId.get(item.data.target ?? '');
            if (!from || !to) return '';
            return tooltipHtml(`${nodeName(from, 'long')} → ${nodeName(to, 'long')}`, [
              {
                color: colorOf.get(from.id) ?? chrome.other,
                name: metricLabel,
                value: format.cell(data.metric, item.data.value),
              },
            ]);
          }
          const node = byId.get(item.data.name ?? '');
          if (!node) return '';
          return tooltipHtml(nodeName(node, 'long'), [
            {
              color: colorOf.get(node.id) ?? chrome.other,
              name: metricLabel,
              value: format.cell(data.metric, node.total),
            },
          ]);
        },
      },
      series: [
        {
          type: 'sankey' as const,
          left: 8,
          right: labelWidth + 10,
          top: 8,
          bottom: 8,
          nodeWidth: 12,
          nodeGap: 10,
          nodeAlign: 'justify' as const,
          layoutIterations: 32,
          emphasis: { focus: 'adjacency' as const },
          data: data.nodes.map((node) => ({
            name: node.id,
            itemStyle: { color: colorOf.get(node.id), borderWidth: 0 },
          })),
          links: data.links.map((link) => ({ ...link })),
          label: {
            color: chrome.inkPrimary,
            fontSize: 11,
            width: labelWidth,
            overflow: 'truncate' as const,
            formatter: (params: { name: string }) => {
              const node = byId.get(params.name);
              if (!node) return '';
              const name = nodeName(node);
              return format.masked ? name : `${name}  ${format.compact(data.metric, node.total)}`;
            },
          },
          lineStyle: { color: 'source' as const, opacity: 0.32, curveness: 0.5 },
        },
      ],
    };
  }, [data, palette, format, source, t, labelWidth]);

  if (!option || !data) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Trans>Nothing to chart for these rows.</Trans>
      </div>
    );
  }
  const from = columnLabel(source, data.from);
  const to = columnLabel(source, data.to);
  const height = Math.max(320, Math.min(900, data.nodes.length * 26));
  return (
    <div
      ref={hostRef}
      className={cn('flex min-h-0 flex-col gap-1', fitHeight && 'h-full', className)}
    >
      <div className="flex justify-between px-2 text-xs text-muted-foreground">
        <span>{from}</span>
        <span style={{ paddingRight: Math.max(0, labelWidth - 16) }}>{to}</span>
      </div>
      <div
        className={cn('min-h-0 w-full', fitHeight && 'min-h-[200px] flex-1')}
        style={fitHeight ? undefined : { height }}
      >
        <EChart option={option} ariaLabel={t`Flow chart`} className="h-full w-full" />
      </div>
    </div>
  );
}
