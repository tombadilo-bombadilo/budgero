import type { ReactNode } from 'react';
import type { ResolvedVisualization } from '@features/reports/lib/question';
import { CalendarHeatmapView } from './CalendarHeatmapView';
import { ComboView } from './ComboView';
import { PivotTableView } from './PivotTableView';
import { RowChartView } from './RowChartView';
import { SankeyView } from './SankeyView';
import { ScatterView } from './ScatterView';
import { TrendNumberView } from './TrendNumberView';
import { WaterfallView } from './WaterfallView';
import type { VizViewProps } from './types';

export interface ExtraVizProps extends VizViewProps {
  exportName?: string;
}

/** The view for the newer chart types; null for the classic ones (ChartView / table / number). */
export function renderExtraVisualization(
  visualization: ResolvedVisualization,
  props: ExtraVizProps
): ReactNode | null {
  switch (visualization) {
    case 'trend':
      return <TrendNumberView {...props} />;
    case 'combo':
      return <ComboView {...props} />;
    case 'pivot':
      return <PivotTableView {...props} />;
    case 'calendar':
      return <CalendarHeatmapView {...props} />;
    case 'waterfall':
      return <WaterfallView {...props} />;
    case 'sankey':
      return <SankeyView {...props} />;
    case 'scatter':
      return <ScatterView {...props} />;
    case 'row':
      return <RowChartView {...props} />;
    default:
      return null;
  }
}
