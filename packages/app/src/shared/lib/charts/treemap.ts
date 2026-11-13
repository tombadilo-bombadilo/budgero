import type { ChartChrome } from './palette';
import { inkOnFill } from './echarts-chrome';

/**
 * The treemap look shared by the Money Map and question treemaps: flat
 * tiles on the card surface with hairline gaps, labels inside, no ECharts
 * zoom or breadcrumb (the pages drill in themselves).
 */
export function treemapSeriesBase(chrome: Pick<ChartChrome, 'surface'>) {
  return {
    type: 'treemap' as const,
    roam: false,
    nodeClick: false as const,
    breadcrumb: { show: false },
    top: 8,
    right: 8,
    bottom: 8,
    left: 8,
    itemStyle: { borderColor: chrome.surface, borderWidth: 2, gapWidth: 2 },
    label: { show: true, fontSize: 12, overflow: 'truncate' as const },
  };
}

/** A tile's fill with readable ink; tiles under `minShare` of the total drop their label. */
export function treemapTileStyle(color: string, share: number, minShare = 0.025) {
  return {
    itemStyle: { color },
    label: { color: inkOnFill(color), show: share >= minShare },
  };
}
