import { RefreshCcw } from 'lucide-react';
import type { PointerEvent, MouseEvent } from 'react';
import { cn } from '@shared/lib/utils';
import { activityTextClass } from '@shared/lib/amount-color';
import { Progress } from '@shared/ui/progress';
import { GoalSection } from '@features/goal-management';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import { useMaskedLocalizer } from '@shared/lib/privacy/useMaskedLocalizer';
import type { MilliUnits } from '@shared/lib/currency/milli';
import { ActivityButton } from './ActivityButton';
import { CategoryRowHeader } from './CategoryRowHeader';
import {
  CategoryAmountsSectionRegular,
  CategoryAmountsSectionCompact,
  CategoryAmountsSectionDesktopCompactMobile,
} from './CategoryAmountsSection';
import { CategoryRowDesktopCompactGrid } from './CategoryRowDesktopCompactGrid';
import { getStatusColor, getCardBorderClasses, type StatusColorParams } from './category-row.utils';

export interface CategoryRowCardLayoutProps {
  item: BudgetRow;
  isExpanded: boolean;
  isHighlighted: boolean;
  isSelected: boolean;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  selectedBudgetId: number;
  layoutVariant: 'default' | 'desktop-compact';
  mobileLayout: 'cards' | 'compact' | 'table';
  highlightAllocated: boolean;
  highlightGoalSection: boolean;
  headerGoalProgressValue: number;
  headerGoalPercent: number;
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
  moveAmount: MilliUnits;
  setMoveAmount: (amount: MilliUnits) => void;
  moveTarget: number | null;
  setMoveTarget: (target: number | null) => void;
  initMovePopover: () => void;
  confirmMove: () => Promise<void>;
  isEditingAllocated: boolean;
  setIsEditingAllocated: (editing: boolean) => void;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  onToggleExpand?: () => void;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: () => void;
  handlePointerLeave: () => void;
  handlePointerCancel: () => void;
  handleClick: (event: MouseEvent<HTMLDivElement>) => void;
}

export function CategoryRowCardLayout({
  item,
  isExpanded,
  isHighlighted,
  isSelected,
  globalLocalizer,
  currentMonth,
  selectedBudgetId,
  layoutVariant,
  mobileLayout,
  highlightAllocated,
  highlightGoalSection,
  headerGoalProgressValue,
  headerGoalPercent,
  moveOpen,
  setMoveOpen,
  moveAmount,
  setMoveAmount,
  moveTarget,
  setMoveTarget,
  initMovePopover,
  confirmMove,
  isEditingAllocated,
  setIsEditingAllocated,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  onToggleExpand,
  handlePointerDown,
  handlePointerUp,
  handlePointerLeave,
  handlePointerCancel,
  handleClick,
}: CategoryRowCardLayoutProps) {
  const maskedLocalizer = useMaskedLocalizer(globalLocalizer);

  const goal = item.goal ?? null;
  const isCompactLayout = mobileLayout === 'compact';
  const isTableLayout = mobileLayout === 'table';
  const forceExpanded = !isTableLayout && !isCompactLayout;

  const statusParams: StatusColorParams = {
    available: item.available,
    goalStatus: item.goalStatus,
  };
  const statusColor = getStatusColor(statusParams);
  const cardBorderClasses = getCardBorderClasses(statusColor);

  return (
    // Presentation wrapper: pointer/click handlers implement long-press +
    // select-handle delegation; the interactive controls live inside the card.
    <div
      role="presentation"
      data-category-id={item.categoryId}
      className={cn(
        'mb-2.5 overflow-hidden rounded-lg border bg-card shadow-sm transition-all hover:shadow-lg hover:border-border/80 dark:bg-card relative select-none',
        'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1',
        cardBorderClasses,
        isHighlighted && 'ring-2 ring-primary/50 shadow-md',
        isSelected &&
          'ring-2 ring-primary/40 bg-primary/5 border-primary/40 dark:ring-white/40 dark:bg-white/10'
      )}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="flex flex-1 flex-col gap-3 text-left select-none">
          {layoutVariant === 'desktop-compact' ? (
            <CategoryRowDesktopCompactGrid
              item={item}
              globalLocalizer={globalLocalizer}
              selectedBudgetId={selectedBudgetId}
              currentMonth={currentMonth}
              highlightAllocated={highlightAllocated}
              onEditCategory={onEditCategory}
              onDeleteCategory={onDeleteCategory}
              onHideCategory={onHideCategory}
              onUpdateAssignment={onUpdateAssignment}
              onActivityClick={onActivityClick}
              onMoveMoney={onMoveMoney}
              moveAmount={moveAmount}
              setMoveAmount={setMoveAmount}
              moveTarget={moveTarget}
              setMoveTarget={setMoveTarget}
              initMovePopover={initMovePopover}
              confirmMove={confirmMove}
            />
          ) : (
            <CategoryRowHeader
              item={item}
              onEditCategory={onEditCategory}
              onDeleteCategory={onDeleteCategory}
              onHideCategory={onHideCategory}
              isCompactLayout={isCompactLayout}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
            />
          )}

          {layoutVariant === 'desktop-compact' ? (
            <CategoryAmountsSectionDesktopCompactMobile
              item={item}
              globalLocalizer={globalLocalizer}
              selectedBudgetId={selectedBudgetId}
              currentMonth={currentMonth}
              highlightAllocated={highlightAllocated}
              onUpdateAssignment={onUpdateAssignment}
              onActivityClick={onActivityClick}
              onMoveMoney={onMoveMoney}
              moveOpen={moveOpen}
              setMoveOpen={setMoveOpen}
              moveAmount={moveAmount}
              setMoveAmount={setMoveAmount}
              moveTarget={moveTarget}
              setMoveTarget={setMoveTarget}
              initMovePopover={initMovePopover}
              confirmMove={confirmMove}
              isEditingAllocated={isEditingAllocated}
              setIsEditingAllocated={setIsEditingAllocated}
            />
          ) : isCompactLayout ? (
            <CategoryAmountsSectionCompact
              item={item}
              globalLocalizer={globalLocalizer}
              selectedBudgetId={selectedBudgetId}
              currentMonth={currentMonth}
              highlightAllocated={highlightAllocated}
              onUpdateAssignment={onUpdateAssignment}
              onMoveMoney={onMoveMoney}
              moveOpen={moveOpen}
              setMoveOpen={setMoveOpen}
              moveAmount={moveAmount}
              setMoveAmount={setMoveAmount}
              moveTarget={moveTarget}
              setMoveTarget={setMoveTarget}
              initMovePopover={initMovePopover}
              confirmMove={confirmMove}
              setIsEditingAllocated={setIsEditingAllocated}
            />
          ) : (
            <CategoryAmountsSectionRegular
              item={item}
              globalLocalizer={globalLocalizer}
              selectedBudgetId={selectedBudgetId}
              currentMonth={currentMonth}
              highlightAllocated={highlightAllocated}
              onUpdateAssignment={onUpdateAssignment}
              onActivityClick={onActivityClick}
              onMoveMoney={onMoveMoney}
              moveOpen={moveOpen}
              setMoveOpen={setMoveOpen}
              moveAmount={moveAmount}
              setMoveAmount={setMoveAmount}
              moveTarget={moveTarget}
              setMoveTarget={setMoveTarget}
              initMovePopover={initMovePopover}
              confirmMove={confirmMove}
              isEditingAllocated={isEditingAllocated}
              setIsEditingAllocated={setIsEditingAllocated}
            />
          )}

          {layoutVariant !== 'desktop-compact' && goal && (
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground md:order-3 md:basis-full">
              <div className="flex-1">
                <Progress value={headerGoalProgressValue} className="h-2 rounded-full" />
              </div>
              <span className="font-semibold text-muted-foreground dark:text-white">
                {headerGoalPercent}%
              </span>
            </div>
          )}
        </div>
      </div>

      {(forceExpanded || isExpanded) && (
        <div
          className={cn(
            'border-t border-border/60 bg-muted/20 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.035]',
            highlightGoalSection && 'ring-2 ring-primary/60 bg-primary/10 animate-pulse'
          )}
        >
          {isCompactLayout && (
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-border/40">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <RefreshCcw className="h-3.5 w-3.5" />
                <span className="uppercase tracking-wide text-[9px]">Activity</span>
              </div>
              <ActivityButton
                item={item}
                globalLocalizer={globalLocalizer}
                onActivityClick={onActivityClick}
                animated={false}
                className={cn(
                  'flex items-center gap-1 text-xs font-semibold transition-colors hover:text-primary',
                  activityTextClass(item.activity)
                )}
              />
            </div>
          )}
          <GoalSection
            categoryId={item.categoryId}
            categoryName={item.name}
            budgetId={selectedBudgetId}
            finances={{
              available: item.available,
              assigned: item.assigned,
              activity: item.activity,
            }}
            currentMonth={currentMonth}
            formatter={maskedLocalizer}
            compact
          />
        </div>
      )}
    </div>
  );
}
