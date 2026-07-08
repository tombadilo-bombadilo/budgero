/**
 * Desktop Budget Table View Component
 *
 * Complete table view for desktop with drag-and-drop support.
 */

import { useMemo, type MouseEvent } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { restrictToVerticalAxis } from '@features/budget-planning/lib/dnd-modifiers';
import type { BudgetRow } from '../../lib/budget-transforms';
import { DesktopBudgetGroupRow, SortableDesktopBudgetGroupRow } from './DesktopBudgetGroupRow';
import {
  DesktopBudgetCategoryRow,
  SortableDesktopBudgetCategoryRow,
} from './DesktopBudgetCategoryRow';
import type { DesktopBudgetTableViewProps } from './types';

export function DesktopBudgetTableView({
  data,
  collapsedGroups,
  groupTotals,
  onToggleGroup,
  onAddCategory,
  onUpdateGroup,
  onDeleteGroup,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  globalLocalizer,
  currentMonth,
  selectedBudgetId,
  selectedCategoryIds,
  onCategoryPress,
  disableSelection = false,
  disableDrag = false,
  sensors,
  onDragStart,
  onDragOver,
  onDragEnd,
  overId,
  isUpdatingGroup = false,
  isDeletingGroup = false,
}: DesktopBudgetTableViewProps) {
  const filteredData = useMemo(
    () =>
      data.filter((row) => {
        if (row.isGroup) return true;
        if (!row.parentId) return true;
        return !collapsedGroups.has(row.parentId);
      }),
    [data, collapsedGroups]
  );

  const headClass = 'h-8 text-xs font-medium uppercase tracking-wide text-muted-foreground';
  const tableHeader = (
    <TableHeader>
      <TableRow>
        <TableHead className={cn(headClass, 'w-[48px]')} />
        <TableHead className={cn(headClass, 'w-auto')}>Category</TableHead>
        <TableHead className={cn(headClass, 'w-[140px] text-right')}>Assigned</TableHead>
        <TableHead className={cn(headClass, 'hidden w-[140px] text-right min-[1250px]:table-cell')}>
          Activity
        </TableHead>
        <TableHead className={cn(headClass, 'w-[160px] text-right pr-6')}>Available</TableHead>
      </TableRow>
    </TableHeader>
  );

  const handleCategorySelect =
    disableSelection || !onCategoryPress
      ? undefined
      : (event: MouseEvent<HTMLElement>, item: BudgetRow) => {
          onCategoryPress(event as MouseEvent<HTMLDivElement>, item);
        };

  // One row-rendering tree for both the static and the sortable table. The
  // sortable wrappers call useSortable, which requires a surrounding
  // DndContext — that is why the fork exists at the component level.
  const renderTable = (sortable: boolean) => (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-background">
      <Table className="w-full">
        {tableHeader}
        <TableBody>
          {filteredData.map((item) => {
            if (item.isGroup) {
              const groupProps = {
                row: item,
                totals: groupTotals.get(item.id),
                isCollapsed: collapsedGroups.has(item.id),
                onToggle: () => onToggleGroup(item.id),
                onAddCategory,
                onUpdateGroup,
                onDeleteGroup,
                globalLocalizer,
                isUpdating: isUpdatingGroup,
                isDeleting: isDeletingGroup,
              };
              return sortable ? (
                <SortableDesktopBudgetGroupRow
                  key={item.id}
                  {...groupProps}
                  overId={overId}
                />
              ) : (
                <DesktopBudgetGroupRow key={item.id} {...groupProps} />
              );
            }
            const categoryProps = {
              row: item,
              globalLocalizer,
              currentMonth,
              selectedBudgetId,
              onEditCategory,
              onDeleteCategory,
              onHideCategory,
              onUpdateAssignment,
              onActivityClick,
              onMoveMoney,
              onSelect: handleCategorySelect,
              isSelected: Boolean(selectedCategoryIds?.has(item.categoryId)),
              selectable: !disableSelection,
            };
            return sortable ? (
              <SortableDesktopBudgetCategoryRow
                key={item.id}
                {...categoryProps}
                overId={overId}
              />
            ) : (
              <DesktopBudgetCategoryRow key={item.id} {...categoryProps} />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  if (disableDrag) {
    return renderTable(false);
  }

  const sortableItems = filteredData.map((item) => item.id);
  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
        {renderTable(true)}
      </SortableContext>
    </DndContext>
  );
}
