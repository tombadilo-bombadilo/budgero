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
import type { CSSProperties } from 'react';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CustomDashboardWithWidgets, UnifiedReport } from '@budgero/core/browser';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { WidgetCard } from './WidgetCard';

interface DashboardGridProps {
  dashboard: CustomDashboardWithWidgets;
  reportsById: Map<string, UnifiedReport>;
  isMobile: boolean;
  isEditMode: boolean;
  onReorderWidgets: (orderedIds: string[]) => Promise<void>;
  onRemoveWidget: (widgetId: string) => Promise<void>;
  onUpdateDesktopLayout: (
    widgetId: string,
    patch: Partial<{ colSpan: number; rowSpan: number }>
  ) => Promise<void>;
  onUpdateMobileSize: (widgetId: string, size: 's' | 'm' | 'l') => Promise<void>;
  onSelectNewChart: (widgetId: string) => void;
  onEditChart: (input: {
    reportId: string;
    reportName: string;
    chart: UnifiedReport['charts'][number];
    queryResult: QueryResult;
  }) => void;
  onOpenReportInExplorer: (reportId: string) => void;
}

function getDesktopGridStyle(layout: { colSpan: number; rowSpan: number }): CSSProperties {
  return {
    gridColumn: `span ${layout.colSpan} / span ${layout.colSpan}`,
    gridRow: `span ${layout.rowSpan} / span ${layout.rowSpan}`,
  };
}

interface SortableWidgetProps extends Omit<DashboardGridProps, 'dashboard' | 'onReorderWidgets'> {
  widget: CustomDashboardWithWidgets['widgets'][number];
}

function SortableWidget({
  widget,
  reportsById,
  isMobile,
  isEditMode,
  onRemoveWidget,
  onUpdateDesktopLayout,
  onUpdateMobileSize,
  onSelectNewChart,
  onEditChart,
  onOpenReportInExplorer,
}: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });

  const report = reportsById.get(widget.reportId) ?? null;
  const chart = report?.charts.find((item) => item.id === widget.chartId) ?? null;

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isMobile
      ? {}
      : {
          ...getDesktopGridStyle(widget.desktopLayout),
        }),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'opacity-60 z-50' : ''}
      {...(isEditMode ? attributes : {})}
      {...(isEditMode ? listeners : {})}
    >
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
        onEditChart={onEditChart}
        onOpenReportInExplorer={onOpenReportInExplorer}
      />
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
  onEditChart,
  onOpenReportInExplorer,
}: DashboardGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const widgetIds = dashboard.widgets.map((item) => item.id);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = widgetIds.findIndex((id) => id === active.id);
    const newIndex = widgetIds.findIndex((id) => id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(widgetIds, oldIndex, newIndex);
    await onReorderWidgets(reordered);
  };

  if (dashboard.widgets.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No widgets yet. Add your first chart widget.
      </div>
    );
  }

  const content = (
    <div className={isMobile ? 'space-y-3' : 'grid grid-cols-12 auto-rows-[140px] gap-4'}>
      {dashboard.widgets.map((widget) => {
        const report = reportsById.get(widget.reportId) ?? null;
        const chart = report?.charts.find((item) => item.id === widget.chartId) ?? null;
        if (!isEditMode) {
          const staticStyle: CSSProperties = isMobile
            ? {}
            : getDesktopGridStyle(widget.desktopLayout);
          return (
            <div key={widget.id} style={staticStyle}>
              <WidgetCard
                widget={widget}
                report={report}
                chart={chart}
                isEditMode={false}
                isMobile={isMobile}
                onRemove={onRemoveWidget}
                onSelectNewChart={onSelectNewChart}
                onUpdateDesktopLayout={onUpdateDesktopLayout}
                onUpdateMobileSize={onUpdateMobileSize}
                onEditChart={onEditChart}
                onOpenReportInExplorer={onOpenReportInExplorer}
              />
            </div>
          );
        }

        return (
          <SortableWidget
            key={widget.id}
            widget={widget}
            reportsById={reportsById}
            isMobile={isMobile}
            isEditMode={isEditMode}
            onRemoveWidget={onRemoveWidget}
            onUpdateDesktopLayout={onUpdateDesktopLayout}
            onUpdateMobileSize={onUpdateMobileSize}
            onSelectNewChart={onSelectNewChart}
            onEditChart={onEditChart}
            onOpenReportInExplorer={onOpenReportInExplorer}
          />
        );
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
