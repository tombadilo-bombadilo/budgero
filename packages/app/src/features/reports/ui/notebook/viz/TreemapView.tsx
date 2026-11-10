import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';
import type { DrillValue } from '@features/reports/lib/question';
import { EChart, type EChartClickParams } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { treemapSeriesBase, treemapTileStyle } from '@shared/lib/charts/treemap';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import type { DrillRequest } from '../DrillMenu';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { withAlpha } from './display';
import { seriesColor } from './series';
import { buildTreemap, type TreemapNode } from './treemap-data';
import { isOther } from './transforms';
import type { VizViewProps } from './types';

interface TileMeta {
  node: TreemapNode;
  parent: TreemapNode | null;
  color: string;
}

/**
 * Tiles sized by the first metric, like the Money Map. With two groupings
 * each parent holds its children; tapping a parent's header opens it, and
 * a tile opens the drill menu.
 */
export function TreemapView({
  result,
  columns,
  source,
  display,
  fitHeight,
  className,
  onDrill,
}: VizViewProps & { onDrill?: (request: DrillRequest) => void }) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source, result);
  const data = useMemo(
    () => buildTreemap(result, columns, display?.topN),
    [result, columns, display?.topN]
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const focus = data?.child ? (data.nodes.find((node) => node.id === focusId) ?? null) : null;

  const { option, metas } = useMemo(() => {
    const metas = new Map<string, TileMeta>();
    if (!data || data.nodes.length === 0) return { option: null, metas };
    const { chrome } = palette;
    const name = (node: TreemapNode, parent: TreemapNode | null) => {
      if (isOther(node.value)) {
        const count = data.otherCount;
        return t`Other (${count})`;
      }
      return format.cell(parent ? data.child! : data.parent, node.value, 'long');
    };
    const colorOf = (position: number, node: TreemapNode) =>
      isOther(node.value) ? chrome.other : seriesColor(palette.series, position);
    const total = focus ? focus.size : data.total;
    const leaf = (node: TreemapNode, parent: TreemapNode | null, color: string) => {
      metas.set(node.id, { node, parent, color });
      return {
        id: node.id,
        name: name(node, parent),
        value: node.size,
        ...treemapTileStyle(color, total > 0 ? node.size / total : 0),
      };
    };
    const shade = (color: string, position: number) =>
      withAlpha(color, Math.max(0.55, 1 - position * 0.09));
    const items = focus
      ? (focus.children ?? []).map((node, position) =>
          leaf(node, focus, shade(colorOf(data.nodes.indexOf(focus), focus), position))
        )
      : data.nodes.map((node, position) => {
          const color = colorOf(position, node);
          if (!data.child || !node.children?.length) return leaf(node, null, color);
          metas.set(node.id, { node, parent: null, color });
          return {
            id: node.id,
            name: name(node, null),
            value: node.size,
            itemStyle: { color, borderColor: color, borderWidth: 2, gapWidth: 1 },
            upperLabel: {
              show: true,
              height: 20,
              color: treemapTileStyle(color, 1).label.color,
              fontSize: 11,
              fontWeight: 600,
            },
            children: node.children.map((child, index) => leaf(child, node, shade(color, index))),
          };
        });
    const metricName = columnLabel(source, data.metric);
    const option: EChartsCoreOption = {
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const item = params as { data?: { id?: string } };
          const meta = item.data?.id ? metas.get(item.data.id) : undefined;
          if (!meta) return '';
          const share = total > 0 ? meta.node.size / total : 0;
          const heading = meta.parent
            ? `${name(meta.parent, null)} › ${name(meta.node, meta.parent)}`
            : name(meta.node, null);
          return tooltipHtml(heading, [
            {
              color: meta.color,
              name: metricName,
              value: `${format.cell(data.metric, meta.node.amount)} · ${format.masked ? '•••' : format.percent(share, 1)}`,
            },
          ]);
        },
      },
      series: [
        {
          ...treemapSeriesBase(chrome),
          // Shapes of the whole: the first level's gaps, children packed tighter.
          levels: [{ itemStyle: { gapWidth: 3, borderWidth: 0 } }, {}],
          label: {
            ...treemapSeriesBase(chrome).label,
            formatter: (params: { name: string; value: number }) =>
              format.masked
                ? params.name
                : `${params.name}\n${format.compact(data.metric, params.value)}`,
            lineHeight: 15,
          },
          data: items,
        },
      ],
    };
    return { option, metas };
  }, [data, focus, palette, format, source, t]);

  if (!data || !option) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Trans>Nothing to chart for these rows.</Trans>
      </div>
    );
  }

  const handleClick = (params: EChartClickParams) => {
    const id = params.dataId;
    const meta = id ? metas.get(id) : undefined;
    if (!meta) return;
    // A parent's header opens it; a tile drills.
    if (data.child && !meta.parent && !focus && meta.node.children?.length) {
      setFocusId(meta.node.id);
      return;
    }
    if (!onDrill || isOther(meta.node.value)) return;
    const values: DrillValue[] = [];
    const parentNode = meta.parent;
    const push = (column: NonNullable<typeof data.child>, node: TreemapNode) =>
      values.push({
        column,
        value: node.value,
        ...(node.key !== undefined ? { key: node.key } : {}),
      });
    if (parentNode) {
      push(data.parent, parentNode);
      if (data.child) push(data.child, meta.node);
    } else push(data.parent, meta.node);
    const box = hostRef.current?.getBoundingClientRect();
    onDrill({
      values,
      anchor: {
        x: params.clientX ?? (box ? box.left + box.width / 2 : 0),
        y: params.clientY ?? (box ? box.top + box.height / 2 : 0),
      },
    });
  };

  const focusName = focus ? format.cell(data.parent, focus.value, 'long') : '';
  const parentName = columnLabel(source, data.parent);
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      {focus && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setFocusId(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <Trans>All {parentName}</Trans>
          </Button>
          <span className="text-sm font-medium">{focusName}</span>
        </div>
      )}
      <div
        ref={hostRef}
        className={cn('min-h-0 w-full', fitHeight ? 'min-h-[180px] flex-1' : 'h-80 sm:h-[26rem]')}
      >
        <EChart
          option={option}
          ariaLabel={t`Treemap`}
          className="h-full w-full"
          onMarkClick={handleClick}
        />
      </div>
    </div>
  );
}
