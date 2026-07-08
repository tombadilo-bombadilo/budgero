import { useState } from 'react';
import { cn } from '@shared/lib/utils';
import { availableAmountClass, activityTextClass } from '@shared/lib/amount-color';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import type { MilliUnits } from '@shared/lib/currency/milli';
import { DesktopCompactHeader } from './CategoryRowHeader';
import { AvailableCell } from './AvailableCell';
import { AllocatedCell } from './AllocatedCell';
import { ActivityButton } from './ActivityButton';

export interface CategoryRowDesktopCompactGridProps {
  item: BudgetRow;
  globalLocalizer: Intl.NumberFormat;
  selectedBudgetId: number;
  currentMonth: string;
  highlightAllocated: boolean;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  // Move money state (amount/target shared with the md:hidden mobile twin)
  moveAmount: MilliUnits;
  setMoveAmount: (amount: MilliUnits) => void;
  moveTarget: number | null;
  setMoveTarget: (target: number | null) => void;
  initMovePopover: () => void;
  confirmMove: () => Promise<void>;
}

export function CategoryRowDesktopCompactGrid({
  item,
  globalLocalizer,
  selectedBudgetId,
  currentMonth,
  highlightAllocated,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  moveAmount,
  setMoveAmount,
  moveTarget,
  setMoveTarget,
  initMovePopover,
  confirmMove,
}: CategoryRowDesktopCompactGridProps) {
  // This grid is CSS-toggled (hidden md:grid) alongside the md:hidden mobile
  // amounts section, which drives its popover from the shared hook state. Two
  // simultaneously mounted controlled popovers cannot share one open flag
  // (the hidden twin would portal its content too), so the grid keeps its own.
  const [gridMoveOpen, setGridMoveOpen] = useState(false);

  const handleConfirmMove = async () => {
    await confirmMove();
    setGridMoveOpen(false);
  };

  return (
    <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(96px,120px)_minmax(96px,120px)_minmax(96px,120px)] items-center gap-2 text-xs md:text-[13px] lg:text-sm">
      {/* Category name and actions */}
      <DesktopCompactHeader
        item={item}
        onEditCategory={onEditCategory}
        onDeleteCategory={onDeleteCategory}
        onHideCategory={onHideCategory}
      />

      {/* Allocated */}
      <div className="text-right">
        <AllocatedCell
          item={item}
          globalLocalizer={globalLocalizer}
          onUpdateAssignment={onUpdateAssignment}
          inputAlign="center"
          placeholder="100 + 50"
          displayClassName={cn(
            'text-xs font-semibold text-foreground transition-colors hover:text-primary lg:text-sm',
            highlightAllocated && 'ring-2 ring-primary/60 bg-primary/10 animate-pulse'
          )}
          inputClassName={cn(
            'h-7 text-sm text-right',
            highlightAllocated && 'ring-2 ring-primary/60'
          )}
        />
      </div>

      {/* Activity */}
      <div className="text-right">
        <ActivityButton
          item={item}
          globalLocalizer={globalLocalizer}
          onActivityClick={onActivityClick}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-semibold transition-colors hover:text-primary hover:cursor-pointer lg:text-sm',
            activityTextClass(item.activity)
          )}
        />
      </div>

      {/* Available */}
      <AvailableCell
        item={item}
        globalLocalizer={globalLocalizer}
        selectedBudgetId={selectedBudgetId}
        currentMonth={currentMonth}
        onMoveMoney={onMoveMoney}
        moveOpen={gridMoveOpen}
        setMoveOpen={setGridMoveOpen}
        moveAmount={moveAmount}
        setMoveAmount={setMoveAmount}
        moveTarget={moveTarget}
        setMoveTarget={setMoveTarget}
        initMovePopover={initMovePopover}
        onConfirmMove={handleConfirmMove}
        className="flex items-center justify-end gap-1"
        triggerClassName="text-xs font-semibold lg:text-sm"
        fallbackClassName={cn(
          'text-xs font-semibold lg:text-sm tabular-nums',
          availableAmountClass(item.available)
        )}
        amountWrapperClassName="text-right"
      />
    </div>
  );
}
