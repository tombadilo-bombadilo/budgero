import { Trans } from '@lingui/react/macro';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type {
  CustomDashboardWidget,
  CustomDashboardWithWidgets,
  UnifiedReport,
} from '@budgero/core/browser';
import type { DashboardFilters } from '@features/reports/lib/question';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import {
  builtinKeyOf,
  visibleFor,
  widgetUsesPeriod,
  type BuiltinCardKey,
} from '@widgets/dashboard/builtin/builtin-cards';
import { WidgetCard } from './WidgetCard';
import { BuiltinWidget } from './BuiltinWidget';
import { sortableTransform } from './sortable-style';
import {
  DASHBOARD_SPACING,
  GRID_COLUMNS,
  ROW_UNIT_PX,
  equalizeBuiltinRows,
  questionHeightPx,
  rowUnitsFor,
  type GridSpacing,
} from './grid-layout';

interface DashboardGridProps {
  dashboard: CustomDashboardWithWidgets;
  reportsById: Map<string, UnifiedReport>;
  isMobile: boolean;
  isEditMode: boolean;
  /** The widgets this platform shows, in their new order. */
  onReorderWidgets: (visibleIds: string[]) => Promise<void>;
  onRemoveWidget: (widgetId: string) => Promise<void>;
  onUpdateDesktopLayout: (
    widgetId: string,
    patch: Partial<{ colSpan: number; rowSpan: number }>
  ) => Promise<void>;
  onUpdateMobileSize: (widgetId: string, size: 's' | 'm' | 'l') => Promise<void>;
  onSelectNewChart: (widgetId: string) => void;
  onOpenReportInExplorer: (reportId: string) => void;
  filters?: DashboardFilters;
  spacing?: GridSpacing;
  /** Phone only: shown just above the first card that follows the period (the period tabs). */
  periodControl?: ReactNode;
  emptyState?: ReactNode;
}

/** First guess of a built-in card's height, until it is measured. */
const ESTIMATED_HEIGHT: Partial<Record<BuiltinCardKey, number>> = {
  cash_balance: 230,
  at_a_glance: 200,
  section_spending: 16,
  section_actions: 16,
};
const DEFAULT_ESTIMATED_HEIGHT = 400;

/** Built-in cards fill the row below this width, as the old home page's cards did. */
const WIDE_BREAKPOINT = 1024;

interface ItemProps extends Pick<
  DashboardGridProps,
  | 'reportsById'
  | 'isMobile'
  | 'isEditMode'
  | 'onRemoveWidget'
  | 'onUpdateDesktopLayout'
  | 'onUpdateMobileSize'
  | 'onSelectNewChart'
  | 'onOpenReportInExplorer'
  | 'filters'
> {
  widget: CustomDashboardWidget;
  style: CSSProperties;
  onHeight: (widgetId: string, px: number) => void;
}

function WidgetContent({
  widget,
  reportsById,
  isMobile,
  isEditMode,
  onRemoveWidget,
  onUpdateDesktopLayout,
  onUpdateMobileSize,
  onSelectNewChart,
  onOpenReportInExplorer,
  filters,
  onHeight,
}: Omit<ItemProps, 'style'>) {
  const cardKey = builtinKeyOf(widget);
  if (cardKey) {
    return (
      <BuiltinWidget
        widget={widget}
        cardKey={cardKey}
        isEditMode={isEditMode}
        isMobile={isMobile}
        onRemove={onRemoveWidget}
        onUpdateDesktopLayout={onUpdateDesktopLayout}
        onHeight={onHeight}
      />
    );
  }
  const report = reportsById.get(widget.reportId) ?? null;
  const chart = report?.charts.find((item) => item.id === widget.chartId) ?? null;
  return (
    <WidgetCard
      widget={widget}
      report={report}
      chart={chart}
      isEditMode={isEditMode}
      isMobile={isMobile}
      onRemove={onRemoveWidget}
      onSelectNewChart={onSelectNewChart}
      onUpdateDesktopLayout={onUpdateDesktopLayout}
      onUpdateMobileSize={onUpdateMobileSize}
      onOpenReportInExplorer={onOpenReportInExplorer}
      filters={filters}
    />
  );
}

function SortableWidget({ style, ...props }: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: props.widget.id,
    });
  return (
    <div
      ref={setNodeRef}
      style={{ ...style, transform: sortableTransform(transform), transition }}
      className={
        isDragging
          ? // The card being moved: its own size, above the others.
            'relative z-50 rounded-2xl opacity-80 shadow-2xl'
          : isOver
            ? // Where it will land.
              'rounded-2xl outline-2 outline-offset-2 outline-dashed outline-primary'
            : ''
      }
      {...attributes}
      {...listeners}
    >
      <WidgetContent {...props} />
    </div>
  );
}

export function DashboardGrid({
  dashboard,
  reportsById,
  isMobile,
  isEditMode,
  onReorderWidgets,
  onRemoveWidget,
  onUpdateDesktopLayout,
  onUpdateMobileSize,
  onSelectNewChart,
  onOpenReportInExplorer,
  filters,
  spacing = DASHBOARD_SPACING,
  periodControl,
  emptyState,
}: DashboardGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const isNarrowDesktop = useIsMobile(WIDE_BREAKPOINT);

  const widgets = useMemo(
    () => visibleFor(dashboard.widgets, isMobile ? 'mobile' : 'desktop'),
    [dashboard.widgets, isMobile]
  );
  const widgetIds = widgets.map((item) => item.id);

  // Measured content heights of built-in cards (desktop grid).
  const [heights, setHeights] = useState<Record<string, number>>({});
  const handleHeight = useCallback((widgetId: string, px: number) => {
    setHeights((current) => (current[widgetId] === px ? current : { ...current, [widgetId]: px }));
  }, []);

  const desktopStyles = useMemo(() => {
    if (isMobile) return null;
    const items = widgets.map((widget) => {
      const cardKey = builtinKeyOf(widget);
      const colSpan =
        cardKey && isNarrowDesktop
          ? GRID_COLUMNS
          : Math.max(1, Math.min(GRID_COLUMNS, widget.desktopLayout.colSpan));
      const heightPx = cardKey
        ? (heights[widget.id] ??
          (cardKey !== 'unknown' ? ESTIMATED_HEIGHT[cardKey] : undefined) ??
          DEFAULT_ESTIMATED_HEIGHT)
        : questionHeightPx(widget.desktopLayout.rowSpan);
      return { colSpan, rowUnits: rowUnitsFor(heightPx, spacing), builtin: Boolean(cardKey) };
    });
    const units = equalizeBuiltinRows(items);
    return items.map((item, index): CSSProperties => ({
      gridColumn: `span ${item.colSpan} / span ${item.colSpan}`,
      gridRow: `span ${units[index]} / span ${units[index]}`,
      paddingBottom: spacing.gapY,
    }));
  }, [widgets, heights, isMobile, isNarrowDesktop, spacing]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = widgetIds.findIndex((id) => id === active.id);
    const newIndex = widgetIds.findIndex((id) => id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    await onReorderWidgets(arrayMove(widgetIds, oldIndex, newIndex));
  };

  if (widgets.length === 0) {
    return (
      emptyState ?? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Trans>No cards on this dashboard yet. Add a question or a built-in card.</Trans>
        </div>
      )
    );
  }

  const periodIndex = periodControl ? widgets.findIndex(widgetUsesPeriod) : -1;

  const content = (
    <div
      className={isMobile ? 'space-y-4' : 'grid grid-cols-12'}
      style={
        isMobile
          ? undefined
          : {
              gridAutoRows: `${ROW_UNIT_PX}px`,
              columnGap: spacing.gapX,
              marginBottom: -spacing.gapY,
            }
      }
    >
      {widgets.map((widget, index) => {
        const props: ItemProps = {
          widget,
          style: desktopStyles?.[index] ?? {},
          reportsById,
          isMobile,
          isEditMode,
          onRemoveWidget,
          onUpdateDesktopLayout,
          onUpdateMobileSize,
          onSelectNewChart,
          onOpenReportInExplorer,
          filters,
          onHeight: handleHeight,
        };
        const item = isEditMode ? (
          <SortableWidget key={widget.id} {...props} />
        ) : (
          <div key={widget.id} style={props.style}>
            <WidgetContent {...props} />
          </div>
        );
        if (isMobile && index === periodIndex) {
          return [
            <div key="period-control" className="flex justify-center">
              {periodControl}
            </div>,
            item,
          ];
        }
        return item;
      })}
    </div>
  );

  if (!isEditMode) {
    return content;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={widgetIds}
        strategy={isMobile ? verticalListSortingStrategy : rectSortingStrategy}
      >
        {content}
      </SortableContext>
    </DndContext>
  );
}
