import type { ReactNode } from 'react';
import type { BreakoutColumn, ResolvedVisualization } from '@features/reports/lib/question';
import type { DrillRequest } from '../DrillMenu';
import { CalendarHeatmapView } from './CalendarHeatmapView';
import { ComboView } from './ComboView';
import { PivotTableView } from './PivotTableView';
import { RowChartView } from './RowChartView';
import { SankeyView } from './SankeyView';
import { ScatterView } from './ScatterView';
import { TrendNumberView } from './TrendNumberView';
import { TreemapView } from './TreemapView';
import { RadarView } from './RadarView';
import { ProgressView } from './ProgressView';
import { WaterfallView } from './WaterfallView';
import type { VizViewProps } from './types';

export interface ExtraVizProps extends VizViewProps {
  exportName?: string;
  /** Drill-through on a clicked mark, cell or day. */
  onDrill?: (request: DrillRequest) => void;
}

function withoutDrill({
  onDrill: _onDrill,
  ...rest
}: ExtraVizProps): Omit<ExtraVizProps, 'onDrill'> {
  return rest;
}

/** The view for the newer chart types; null for the classic ones (ChartView / table / number). */
export function renderExtraVisualization(
  visualization: ResolvedVisualization,
  props: ExtraVizProps
): ReactNode | null {
  switch (visualization) {
    case 'trend':
      return <TrendNumberView {...withoutDrill(props)} />;
    case 'combo':
      return <ComboView {...withoutDrill(props)} />;
    case 'pivot':
      return <PivotTableView {...props} />;
    case 'calendar': {
      const { onDrill, ...rest } = props;
      const dayColumn = props.columns.find(
        (column): column is BreakoutColumn => column.kind === 'breakout'
      );
      return (
        <CalendarHeatmapView
          {...rest}
          onDayClick={
            onDrill && dayColumn
              ? (day, anchor) => onDrill({ values: [{ column: dayColumn, value: day }], anchor })
              : undefined
          }
        />
      );
    }
    case 'waterfall':
      return <WaterfallView {...withoutDrill(props)} />;
    case 'sankey':
      return <SankeyView {...withoutDrill(props)} />;
    case 'scatter':
      return <ScatterView {...withoutDrill(props)} />;
    case 'row':
      return <RowChartView {...props} />;
    case 'treemap':
      return <TreemapView {...props} />;
    case 'radar':
      return <RadarView {...withoutDrill(props)} />;
    case 'progress':
      return <ProgressView {...withoutDrill(props)} />;
    default:
      return null;
  }
}
