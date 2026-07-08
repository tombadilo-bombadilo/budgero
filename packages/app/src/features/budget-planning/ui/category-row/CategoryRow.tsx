import type { MouseEvent, PointerEvent } from 'react';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import { useCategoryRowState } from './useCategoryRowState';
import { CategoryRowTableLayout } from './CategoryRowTableLayout';
import { CategoryRowCardLayout } from './CategoryRowCardLayout';

export interface CategoryRowProps {
  item: BudgetRow;
  isExpanded: boolean;
  isHighlighted: boolean;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  selectedBudgetId: number;
  isSelected: boolean;
  onPress?: (event: MouseEvent<HTMLDivElement>) => void;
  onLongPress?: (event: PointerEvent<HTMLDivElement>) => void;
  longPressDuration?: number;
  layoutVariant?: 'default' | 'desktop-compact';
  mobileLayout?: 'cards' | 'compact' | 'table';
  onToggleExpand?: () => void;
}

export function CategoryRow({
  item,
  isExpanded,
  isHighlighted,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  globalLocalizer,
  currentMonth,
  selectedBudgetId,
  isSelected,
  onPress,
  onLongPress,
  longPressDuration = 500,
  layoutVariant = 'default',
  mobileLayout = 'cards',
  onToggleExpand,
}: CategoryRowProps) {
  const isTableLayout = mobileLayout === 'table';

  const state = useCategoryRowState({
    categoryId: item.categoryId,
    available: item.available,
    assigned: item.assigned,
    activity: item.activity,
    goal: item.goal ?? null,
    globalLocalizer,
    currentMonth,
    onMoveMoney,
    onLongPress,
    onPress,
    longPressDuration,
  });

  if (isTableLayout) {
    return (
      <CategoryRowTableLayout
        item={item}
        isExpanded={isExpanded}
        isHighlighted={isHighlighted}
        isSelected={isSelected}
        globalLocalizer={globalLocalizer}
        currentMonth={currentMonth}
        selectedBudgetId={selectedBudgetId}
        highlightAllocated={state.highlightAllocated}
        highlightGoalSection={state.highlightGoalSection}
        onEditCategory={onEditCategory}
        onDeleteCategory={onDeleteCategory}
        onHideCategory={onHideCategory}
        onUpdateAssignment={onUpdateAssignment}
        onActivityClick={onActivityClick}
        onMoveMoney={onMoveMoney}
        onToggleExpand={onToggleExpand}
        setIsEditingAllocated={state.setIsEditingAllocated}
        moveOpen={state.moveOpen}
        setMoveOpen={state.setMoveOpen}
        moveAmount={state.moveAmount}
        setMoveAmount={state.setMoveAmount}
        moveTarget={state.moveTarget}
        setMoveTarget={state.setMoveTarget}
        initMovePopover={state.initMovePopover}
        confirmMove={state.confirmMove}
        handlePointerDown={state.handlePointerDown}
        handlePointerUp={state.handlePointerUp}
        handlePointerLeave={state.handlePointerLeave}
        handlePointerCancel={state.handlePointerCancel}
        handleClick={state.handleClick}
      />
    );
  }

  // Card layout (default and compact)
  return (
    <CategoryRowCardLayout
      item={item}
      isExpanded={isExpanded}
      isHighlighted={isHighlighted}
      isSelected={isSelected}
      globalLocalizer={globalLocalizer}
      currentMonth={currentMonth}
      selectedBudgetId={selectedBudgetId}
      layoutVariant={layoutVariant}
      mobileLayout={mobileLayout}
      highlightAllocated={state.highlightAllocated}
      highlightGoalSection={state.highlightGoalSection}
      headerGoalProgressValue={state.headerGoalProgressValue}
      headerGoalPercent={state.headerGoalPercent}
      moveOpen={state.moveOpen}
      setMoveOpen={state.setMoveOpen}
      moveAmount={state.moveAmount}
      setMoveAmount={state.setMoveAmount}
      moveTarget={state.moveTarget}
      setMoveTarget={state.setMoveTarget}
      initMovePopover={state.initMovePopover}
      confirmMove={state.confirmMove}
      isEditingAllocated={state.isEditingAllocated}
      setIsEditingAllocated={state.setIsEditingAllocated}
      onEditCategory={onEditCategory}
      onDeleteCategory={onDeleteCategory}
      onHideCategory={onHideCategory}
      onUpdateAssignment={onUpdateAssignment}
      onActivityClick={onActivityClick}
      onMoveMoney={onMoveMoney}
      onToggleExpand={onToggleExpand}
      handlePointerDown={state.handlePointerDown}
      handlePointerUp={state.handlePointerUp}
      handlePointerLeave={state.handlePointerLeave}
      handlePointerCancel={state.handlePointerCancel}
      handleClick={state.handleClick}
    />
  );
}
