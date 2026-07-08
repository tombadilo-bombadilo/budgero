import { Wallet, RefreshCcw, CheckCircle2 } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { availableAmountClass, activityTextClass } from '@shared/lib/amount-color';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import type { MilliUnits } from '@shared/lib/currency/milli';
import { AvailableCell } from './AvailableCell';
import { AllocatedCell } from './AllocatedCell';
import { ActivityButton } from './ActivityButton';

export interface CategoryAmountsSectionProps {
  item: BudgetRow;
  globalLocalizer: Intl.NumberFormat;
  selectedBudgetId: number;
  currentMonth: string;
  highlightAllocated: boolean;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
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
}

export function CategoryAmountsSectionRegular({
  item,
  globalLocalizer,
  selectedBudgetId,
  currentMonth,
  highlightAllocated,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
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
}: CategoryAmountsSectionProps) {
  return (
    <div className="mt-0 flex flex-col gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground sm:flex-row sm:items-start sm:gap-2">
      {/* Allocated */}
      <div className="flex flex-1 items-center justify-between gap-2 sm:min-w-[120px] sm:flex-col sm:items-center sm:gap-1 sm:border-l sm:border-border/60 sm:pl-2 sm:text-center first:sm:border-l-0 first:sm:pl-0">
        <div className="flex items-center gap-1 text-muted-foreground sm:justify-center">
          <Wallet className="h-4 w-4" />
          <span className="uppercase tracking-wide text-[9px] lg:text-[10px] sm:text-center">
            Allocated
          </span>
        </div>
        <div className="flex-1 text-right sm:flex-none sm:w-full sm:text-center">
          <AllocatedCell
            item={item}
            globalLocalizer={globalLocalizer}
            onUpdateAssignment={onUpdateAssignment}
            onEditingChange={setIsEditingAllocated}
            inputAlign="center"
            placeholder="100 + 50"
            displayClassName={cn(
              'text-xs font-semibold text-foreground transition-colors hover:text-primary text-right sm:text-center lg:text-sm',
              highlightAllocated && 'ring-2 ring-primary/60 bg-primary/10 animate-pulse'
            )}
            inputClassName={cn(
              'h-7 text-xs lg:text-sm text-right sm:text-center max-w-[6rem] ml-auto sm:ml-0',
              !isEditingAllocated &&
                'border-none bg-transparent shadow-none focus-visible:ring-0 px-0 h-auto font-semibold',
              highlightAllocated && 'ring-2 ring-primary/60'
            )}
          />
        </div>
      </div>

      {/* Activity */}
      <div className="flex flex-1 items-center justify-between gap-2 sm:min-w-[120px] sm:flex-col sm:items-center sm:gap-1 sm:border-l sm:border-border/60 sm:pl-2 sm:text-center first:sm:border-l-0 first:sm:pl-0">
        <div className="flex items-center gap-1 text-muted-foreground sm:justify-center">
          <RefreshCcw className="h-4 w-4" />
          <span className="uppercase tracking-wide text-[9px] lg:text-[10px] sm:text-center">
            Activity
          </span>
        </div>
        <div className="flex items-center justify-end gap-1 text-xs font-semibold text-foreground sm:justify-center sm:text-center lg:text-sm">
          <ActivityButton
            item={item}
            globalLocalizer={globalLocalizer}
            onActivityClick={onActivityClick}
            withTestId
            className={cn(
              'flex items-center gap-1 transition-colors hover:text-primary hover:cursor-pointer',
              activityTextClass(item.activity)
            )}
          />
        </div>
      </div>

      {/* Available */}
      <div className="flex flex-1 items-center justify-between gap-2 sm:min-w-[120px] sm:flex-col sm:items-center sm:gap-1 sm:border-l sm:border-border/60 sm:pl-2 sm:text-center first:sm:border-l-0 first:sm:pl-0">
        <div className="flex items-center gap-1 text-muted-foreground sm:justify-center">
          <CheckCircle2 className="h-4 w-4" />
          <span className="uppercase tracking-wide text-[9px] lg:text-[10px] sm:text-center">
            Available
          </span>
        </div>
        <AvailableCell
          item={item}
          globalLocalizer={globalLocalizer}
          selectedBudgetId={selectedBudgetId}
          currentMonth={currentMonth}
          onMoveMoney={onMoveMoney}
          moveOpen={moveOpen}
          setMoveOpen={setMoveOpen}
          moveAmount={moveAmount}
          setMoveAmount={setMoveAmount}
          moveTarget={moveTarget}
          setMoveTarget={setMoveTarget}
          initMovePopover={initMovePopover}
          onConfirmMove={confirmMove}
          className="flex items-center justify-end gap-1 text-xs font-semibold text-foreground text-right sm:justify-center sm:text-center lg:text-sm"
          fallbackClassName={cn('tabular-nums', availableAmountClass(item.available))}
        />
      </div>
    </div>
  );
}

export function CategoryAmountsSectionCompact({
  item,
  globalLocalizer,
  selectedBudgetId,
  currentMonth,
  highlightAllocated,
  onUpdateAssignment,
  onMoveMoney,
  moveOpen,
  setMoveOpen,
  moveAmount,
  setMoveAmount,
  moveTarget,
  setMoveTarget,
  initMovePopover,
  confirmMove,
  setIsEditingAllocated,
}: Pick<
  CategoryAmountsSectionProps,
  | 'item'
  | 'globalLocalizer'
  | 'selectedBudgetId'
  | 'currentMonth'
  | 'highlightAllocated'
  | 'onUpdateAssignment'
  | 'onMoveMoney'
  | 'moveOpen'
  | 'setMoveOpen'
  | 'moveAmount'
  | 'setMoveAmount'
  | 'moveTarget'
  | 'setMoveTarget'
  | 'initMovePopover'
  | 'confirmMove'
  | 'setIsEditingAllocated'
>) {
  return (
    <div className="mt-0 grid grid-cols-2 gap-x-1 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground overflow-hidden">
      <div className="flex flex-col items-end gap-0 px-1 min-w-0">
        <span className="uppercase tracking-wide text-[8px] text-muted-foreground self-start">
          Alloc.
        </span>
        <div className="min-w-0 w-full">
          <AllocatedCell
            item={item}
            globalLocalizer={globalLocalizer}
            onUpdateAssignment={onUpdateAssignment}
            onEditingChange={setIsEditingAllocated}
            inputAlign="right"
            placeholder="0"
            displayClassName={cn(
              'text-xs font-semibold text-foreground transition-colors hover:text-primary text-right',
              highlightAllocated && 'ring-2 ring-primary/60 bg-primary/10 animate-pulse'
            )}
            inputClassName={cn(
              'h-6 text-xs text-right max-w-full',
              highlightAllocated && 'ring-2 ring-primary/60'
            )}
          />
        </div>
      </div>
      <div className="flex flex-col items-end gap-0 px-1 min-w-0">
        <span className="uppercase tracking-wide text-[8px] text-muted-foreground self-start">
          Avail.
        </span>
        <AvailableCell
          item={item}
          globalLocalizer={globalLocalizer}
          selectedBudgetId={selectedBudgetId}
          currentMonth={currentMonth}
          onMoveMoney={onMoveMoney}
          moveOpen={moveOpen}
          setMoveOpen={setMoveOpen}
          moveAmount={moveAmount}
          setMoveAmount={setMoveAmount}
          moveTarget={moveTarget}
          setMoveTarget={setMoveTarget}
          initMovePopover={initMovePopover}
          onConfirmMove={confirmMove}
          className="flex items-center gap-0.5 min-w-0 justify-end"
          triggerClassName="text-xs font-semibold"
          fallbackClassName={cn(
            'text-xs font-semibold tabular-nums',
            availableAmountClass(item.available)
          )}
        />
      </div>
    </div>
  );
}

export function CategoryAmountsSectionDesktopCompactMobile({
  item,
  globalLocalizer,
  selectedBudgetId,
  currentMonth,
  highlightAllocated,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  moveOpen,
  setMoveOpen,
  moveAmount,
  setMoveAmount,
  moveTarget,
  setMoveTarget,
  initMovePopover,
  confirmMove,
}: CategoryAmountsSectionProps) {
  return (
    <div className="md:hidden mt-0 flex flex-col gap-1 border-t border-border/60 pt-1 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-1 sm:text-center">
      {/* Allocated */}
      <div className="flex flex-1 items-center justify-between gap-1 sm:flex-1 sm:min-w-0 sm:border-l sm:border-border/60 sm:px-1 sm:first:pl-0 sm:first:border-l-0 sm:last:pr-0 sm:justify-center">
        <div className="flex items-center gap-1 sm:justify-center">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <span className="uppercase tracking-wide text-[9px] lg:text-[10px]">Allocated</span>
        </div>
        <AllocatedCell
          item={item}
          globalLocalizer={globalLocalizer}
          onUpdateAssignment={onUpdateAssignment}
          inputAlign="center"
          placeholder="100 + 50"
          displayClassName={cn(
            'text-xs font-semibold text-foreground transition-colors hover:text-primary sm:text-center lg:text-sm',
            highlightAllocated && 'ring-2 ring-primary/60 bg-primary/10 animate-pulse'
          )}
          inputClassName={cn(
            'h-7 text-sm sm:text-center',
            highlightAllocated && 'ring-2 ring-primary/60'
          )}
        />
      </div>

      {/* Activity */}
      <div className="flex flex-1 items-center justify-between gap-1 sm:flex-1 sm:min-w-0 sm:border-l sm:border-border/60 sm:px-2 sm:first:pl-0 sm:last:pr-0 sm:justify-center">
        <div className="flex items-center gap-1 sm:justify-center">
          <RefreshCcw className="h-4 w-4 text-muted-foreground" />
          <span className="uppercase tracking-wide text-[9px] lg:text-[10px]">Activity</span>
        </div>
        <ActivityButton
          item={item}
          globalLocalizer={globalLocalizer}
          onActivityClick={onActivityClick}
          withTestId
          className={cn(
            'flex items-center gap-1 text-xs font-semibold transition-colors hover:text-primary hover:cursor-pointer text-right sm:justify-center sm:text-center lg:text-sm',
            activityTextClass(item.activity)
          )}
        />
      </div>

      {/* Available */}
      <div className="flex flex-1 items-center justify-between gap-1 sm:flex-1 sm:min-w-0 sm:border-l sm:border-border/60 sm:px-2 sm:first:pl-0 sm:last:pr-0 sm:justify-center">
        <div className="flex items-center gap-1 sm:justify-center">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          <span className="uppercase tracking-wide text-[9px] lg:text-[10px]">Available</span>
        </div>
        <AvailableCell
          item={item}
          globalLocalizer={globalLocalizer}
          selectedBudgetId={selectedBudgetId}
          currentMonth={currentMonth}
          onMoveMoney={onMoveMoney}
          moveOpen={moveOpen}
          setMoveOpen={setMoveOpen}
          moveAmount={moveAmount}
          setMoveAmount={setMoveAmount}
          moveTarget={moveTarget}
          setMoveTarget={setMoveTarget}
          initMovePopover={initMovePopover}
          onConfirmMove={confirmMove}
          className="flex items-center gap-1 text-xs font-semibold text-right sm:justify-center sm:text-center lg:text-sm"
          fallbackClassName={cn('tabular-nums', availableAmountClass(item.available))}
        />
      </div>
    </div>
  );
}
