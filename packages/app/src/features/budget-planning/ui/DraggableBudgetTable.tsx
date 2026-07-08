/**
 * Draggable Budget Table
 *
 * Main budget table with drag-and-drop reordering support.
 * Supports multiple layout variants (mobile cards, compact, table, desktop-table).
 */

import { useState, useMemo, type MouseEvent, type PointerEvent } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  closestCenter,
  KeyboardSensor,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@features/budget-planning/lib/dnd-modifiers';
import { cn } from '@shared/lib/utils';
import { BudgetRow } from '../lib/budget-transforms';
import { DraggableCategoryGroupRow } from './DraggableCategoryGroupRow';
import { DraggableCategoryRow } from './DraggableCategoryRow';
import { CategoryGroupRow } from './CategoryGroupRow';
import { CategoryRow } from './category-row';
import { EmptyStateDisplay } from './EmptyStateDisplay';
import { DesktopBudgetTableView } from './desktop-table';

interface DraggableBudgetTableProps {
  data: BudgetRow[];
  unfilteredData?: BudgetRow[];
  searchTerm: string;
  collapsedGroups: Set<string>;
  expandedCategories: Set<string>;
  highlightedCategoryId: number | null;
  onToggleGroup: (groupId: string) => void;
  onToggleCategory?: (categoryId: string) => void;
  onAddCategory: (groupId: number) => void;
  onUpdateGroup: (id: number, name: string) => Promise<void>;
  onDeleteGroup: (item: BudgetRow) => Promise<void>;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  onReorderItems: (
    items: BudgetRow[],
    movedCategoryInfo?: {
      categoryId: number;
      oldGroupId: number;
      newGroupId: number;
    }
  ) => void;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  selectedBudgetId: number;
  isUpdatingGroup?: boolean;
  isDeletingGroup?: boolean;
  disableDrag?: boolean;
  selectedCategoryIds?: Set<number>;
  onCategoryPress?: (event: MouseEvent<HTMLDivElement>, item: BudgetRow) => void;
  onCategoryLongPress?: (event: PointerEvent<HTMLDivElement>, item: BudgetRow) => void;
  longPressDuration?: number;
  layoutVariant?: 'default' | 'desktop-compact' | 'desktop-table';
  disableSelection?: boolean;
  mobileLayout?: 'cards' | 'compact' | 'table';
}

export function DraggableBudgetTable({
  data,
  unfilteredData,
  searchTerm,
  collapsedGroups,
  expandedCategories,
  highlightedCategoryId,
  onToggleGroup,
  onToggleCategory,
  onAddCategory,
  onUpdateGroup,
  onDeleteGroup,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  onReorderItems,
  globalLocalizer,
  currentMonth,
  selectedBudgetId,
  isUpdatingGroup = false,
  isDeletingGroup = false,
  disableDrag = false,
  selectedCategoryIds,
  onCategoryPress,
  onCategoryLongPress,
  longPressDuration,
  layoutVariant = 'default',
  disableSelection = false,
  mobileLayout = 'cards',
}: DraggableBudgetTableProps) {
  const isTableLayout = mobileLayout === 'table';
  const isCompactLayout = mobileLayout === 'compact';
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortableItems = data.map((item) => item.id);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverId(event.over?.id as string | null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setActiveId(null);
      setOverId(null);
      return;
    }

    const activeItem = data.find((item) => item.id === active.id);
    const overItem = data.find((item) => item.id === over.id);

    if (!activeItem || !overItem) {
      setActiveId(null);
      setOverId(null);
      return;
    }

    const newData = [...data];
    const activeIndex = newData.findIndex((item) => item.id === active.id);
    const overIndex = newData.findIndex((item) => item.id === over.id);

    let movedCategoryInfo:
      | { categoryId: number; oldGroupId: number; newGroupId: number }
      | undefined;

    if (!activeItem.isGroup) {
      if (overItem.isGroup) {
        const updatedCategory = { ...activeItem, parentId: overItem.id };

        if (
          activeItem.parentId !== overItem.id &&
          activeItem.categoryId &&
          overItem.categoryGroupId
        ) {
          const oldGroup = data.find((item) => item.id === activeItem.parentId);
          if (oldGroup?.categoryGroupId) {
            movedCategoryInfo = {
              categoryId: activeItem.categoryId,
              oldGroupId: oldGroup.categoryGroupId,
              newGroupId: overItem.categoryGroupId,
            };
          }
        }

        newData.splice(activeIndex, 1);
        const insertIndex = newData.findIndex((item) => item.id === overItem.id) + 1;
        newData.splice(insertIndex, 0, updatedCategory);
      } else {
        const targetGroupId = overItem.parentId;
        const isSameGroup = activeItem.parentId === targetGroupId;
        const movingDown = activeIndex < overIndex;

        let updatedCategory = activeItem;
        if (!isSameGroup) {
          updatedCategory = { ...activeItem, parentId: targetGroupId };

          if (activeItem.categoryId && targetGroupId) {
            const oldGroup = data.find((item) => item.id === activeItem.parentId);
            const newGroup = data.find((item) => item.id === targetGroupId);

            if (oldGroup?.categoryGroupId && newGroup?.categoryGroupId) {
              movedCategoryInfo = {
                categoryId: activeItem.categoryId,
                oldGroupId: oldGroup.categoryGroupId,
                newGroupId: newGroup.categoryGroupId,
              };
            }
          }
        }

        newData.splice(activeIndex, 1);
        let insertIndex = newData.findIndex((item) => item.id === overItem.id);

        if (movingDown && isSameGroup) {
          insertIndex++;
        }

        if (!isSameGroup && movingDown) {
          insertIndex++;
        }

        newData.splice(insertIndex, 0, updatedCategory);
      }
    } else if (overItem.isGroup) {
      const draggedGroup = newData[activeIndex];
      const movingDown = activeIndex < overIndex;

      const draggedGroupItems = [];
      for (let i = activeIndex + 1; i < newData.length; i++) {
        if (newData[i].isGroup) break;
        if (newData[i].parentId === draggedGroup.id) {
          draggedGroupItems.push(newData[i]);
        }
      }

      const removedItems = newData.splice(activeIndex, 1 + draggedGroupItems.length);

      let insertIndex;
      if (movingDown) {
        insertIndex = newData.findIndex((item) => item.id === overItem.id);
        for (let i = insertIndex + 1; i < newData.length; i++) {
          if (newData[i].isGroup) break;
          if (newData[i].parentId === overItem.id) {
            insertIndex = i;
          }
        }
        insertIndex++;
      } else {
        insertIndex = newData.findIndex((item) => item.id === overItem.id);
      }

      newData.splice(insertIndex, 0, ...removedItems);
    }

    onReorderItems(newData, movedCategoryInfo);
    setActiveId(null);
    setOverId(null);
  };

  const groupTotals = useMemo(() => {
    const totals = new Map<string, { assigned: number; activity: number; available: number }>();
    const dataForTotals = unfilteredData || data;
    dataForTotals.forEach((row) => {
      if (!row.isGroup && row.parentId) {
        const current = totals.get(row.parentId) || { assigned: 0, activity: 0, available: 0 };
        current.assigned += row.assigned;
        current.activity += row.activity;
        current.available += row.available;
        totals.set(row.parentId, current);
      }
    });
    return totals;
  }, [data, unfilteredData]);

  const header =
    layoutVariant === 'desktop-compact' ? (
      <div className="hidden md:block sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/50 -mx-1 px-1 md:-mx-2 md:px-2">
        <div className="px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground grid grid-cols-[minmax(0,1fr)_minmax(96px,120px)_minmax(96px,120px)_minmax(96px,120px)] gap-2">
          <div>Category</div>
          <div className="text-right">Allocated</div>
          <div className="text-right">Activity</div>
          <div className="text-right">Available</div>
        </div>
      </div>
    ) : isTableLayout ? (
      <div className="md:hidden sticky top-0 z-10 bg-muted/90 backdrop-blur-sm border-b border-border/40 rounded-t-lg">
        <div className="py-1 text-[9px] uppercase tracking-wider font-medium text-muted-foreground/60 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 items-center pl-4 pr-2">
          <div>Category</div>
          <div className="text-right">Allocated</div>
          <div className="text-right">Available</div>
        </div>
      </div>
    ) : null;

  if (data.length === 0) {
    return (
      <>
        {header}
        <EmptyStateDisplay type="no-search-results" searchTerm={searchTerm} />
      </>
    );
  }

  if (layoutVariant === 'desktop-table') {
    return (
      <DesktopBudgetTableView
        data={data}
        collapsedGroups={collapsedGroups}
        groupTotals={groupTotals}
        onToggleGroup={onToggleGroup}
        onAddCategory={onAddCategory}
        onUpdateGroup={onUpdateGroup}
        onDeleteGroup={onDeleteGroup}
        onEditCategory={onEditCategory}
        onDeleteCategory={onDeleteCategory}
        onHideCategory={onHideCategory}
        onUpdateAssignment={onUpdateAssignment}
        onActivityClick={onActivityClick}
        onMoveMoney={onMoveMoney}
        globalLocalizer={globalLocalizer}
        currentMonth={currentMonth}
        selectedBudgetId={selectedBudgetId}
        selectedCategoryIds={selectedCategoryIds}
        onCategoryPress={onCategoryPress}
        disableSelection={disableSelection}
        disableDrag={disableDrag}
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        overId={overId}
        isUpdatingGroup={isUpdatingGroup}
        isDeletingGroup={isDeletingGroup}
      />
    );
  }

  // The desktop-table early return above narrows layoutVariant; capture the
  // narrowed type in a const so the renderRows closure keeps it.
  const rowLayoutVariant = layoutVariant;

  // One row-rendering tree for both the static and the draggable list. The
  // draggable wrappers call useSortable, which requires a surrounding
  // DndContext — that is why the fork exists at the component level.
  const renderRows = (sortable: boolean) =>
    data.map((item) => {
      if (item.isGroup) {
        const groupProps = {
          item,
          isCollapsed: collapsedGroups.has(item.id),
          onToggle: () => onToggleGroup(item.id),
          onAddCategory,
          onUpdateGroup,
          onDeleteGroup,
          globalLocalizer,
          isUpdating: isUpdatingGroup,
          isDeleting: isDeletingGroup,
          layoutVariant: rowLayoutVariant,
          mobileLayout,
        };
        return sortable ? (
          <DraggableCategoryGroupRow
            key={item.id}
            id={item.id}
            {...groupProps}
            isDragging={activeId === item.id}
            isOver={overId === item.id}
          />
        ) : (
          <CategoryGroupRow key={item.id} {...groupProps} />
        );
      }
      const rowProps = {
        item,
        isExpanded: isTableLayout || isCompactLayout ? expandedCategories.has(item.id) : true,
        isHighlighted: highlightedCategoryId === item.categoryId,
        onEditCategory,
        onDeleteCategory,
        onHideCategory,
        onUpdateAssignment,
        onActivityClick,
        onMoveMoney,
        globalLocalizer,
        currentMonth,
        selectedBudgetId,
        isSelected: Boolean(selectedCategoryIds?.has(item.categoryId)),
        onPress: onCategoryPress
          ? (event: MouseEvent<HTMLDivElement>) => onCategoryPress(event, item)
          : undefined,
        onLongPress: onCategoryLongPress
          ? (event: PointerEvent<HTMLDivElement>) => onCategoryLongPress(event, item)
          : undefined,
        longPressDuration,
        layoutVariant: rowLayoutVariant,
        mobileLayout,
        onToggleExpand: onToggleCategory ? () => onToggleCategory(item.id) : undefined,
      };
      return sortable ? (
        <DraggableCategoryRow
          key={item.id}
          id={item.id}
          {...rowProps}
          isDragging={activeId === item.id}
          isOver={overId === item.id}
        />
      ) : (
        <CategoryRow key={item.id} {...rowProps} />
      );
    });

  if (disableDrag) {
    return (
      <>
        {header}
        <div
          className={cn(
            !isTableLayout && 'select-none',
            isTableLayout
              ? 'rounded-lg border border-border/60 bg-card overflow-hidden'
              : 'space-y-0.5'
          )}
          data-budget-table-root
        >
          {renderRows(false)}
        </div>
      </>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
        {header}
        <div
          className={cn(
            isTableLayout
              ? 'rounded-lg border border-border/60 bg-card overflow-hidden'
              : 'space-y-0.5'
          )}
          data-budget-table-root
        >
          {renderRows(true)}
        </div>
      </SortableContext>
    </DndContext>
  );
}
