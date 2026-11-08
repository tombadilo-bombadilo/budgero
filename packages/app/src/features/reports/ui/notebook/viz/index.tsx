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
import { WaterfallView } from './WaterfallView';
import type { VizViewProps } from './types';

export interface ExtraVizProps extends VizViewProps {
  exportName?: string;
  /** Drill-through on a clicked day (calendar). */
  onDrill?: (request: DrillRequest) => void;
}

/** Where the pointer last went down, so the drill menu opens next to the clicked day. */
let lastPointer = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    },
    { capture: true, passive: true }
  );
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
              ? (day) =>
                  onDrill({ values: [{ column: dayColumn, value: day }], anchor: lastPointer })
              : undefined
          }
        />
      );
    }
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
