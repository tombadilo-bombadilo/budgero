import { Edit3, Trash, ChevronRight, EyeOff } from 'lucide-react';
import type { PointerEvent, MouseEvent } from 'react';
import { cn } from '@shared/lib/utils';
import { buttonizeProps } from '@shared/lib/a11y';
import { Button } from '@shared/ui/button';
import { useMaskedLocalizer } from '@shared/lib/privacy/useMaskedLocalizer';
import { GoalSection } from '@features/goal-management';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import type { MilliUnits } from '@shared/lib/currency/milli';
import { AvailableCell } from './AvailableCell';
import { AllocatedCell } from './AllocatedCell';
import { ActivityButton } from './ActivityButton';
import { getStatusColor, getStatusDotClasses, type StatusColorParams } from './category-row.utils';

export interface CategoryRowTableLayoutProps {
  item: BudgetRow;
  isExpanded: boolean;
  isHighlighted: boolean;
  isSelected: boolean;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  selectedBudgetId: number;
  highlightAllocated: boolean;
  highlightGoalSection: boolean;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  onToggleExpand?: () => void;
  setIsEditingAllocated: (editing: boolean) => void;
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
  moveAmount: MilliUnits;
  setMoveAmount: (amount: MilliUnits) => void;
  moveTarget: number | null;
  setMoveTarget: (target: number | null) => void;
  initMovePopover: () => void;
  confirmMove: () => Promise<void>;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: () => void;
  handlePointerLeave: () => void;
  handlePointerCancel: () => void;
  handleClick: (event: MouseEvent<HTMLDivElement>) => void;
}

export function CategoryRowTableLayout({
  item,
  isExpanded,
  isHighlighted,
  isSelected,
  globalLocalizer,
  currentMonth,
  selectedBudgetId,
  highlightAllocated,
  highlightGoalSection,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  onToggleExpand,
  setIsEditingAllocated,
  moveOpen,
  setMoveOpen,
  moveAmount,
  setMoveAmount,
  moveTarget,
  setMoveTarget,
  initMovePopover,
  confirmMove,
  handlePointerDown,
  handlePointerUp,
  handlePointerLeave,
  handlePointerCancel,
  handleClick,
}: CategoryRowTableLayoutProps) {
  const maskedLocalizer = useMaskedLocalizer(globalLocalizer);

  const statusParams: StatusColorParams = {
    available: item.available,
    goalStatus: item.goalStatus,
  };
  const statusColor = getStatusColor(statusParams);

  return (
    // Presentation wrapper: pointer/click handlers implement long-press +
    // select-handle delegation; the interactive controls live inside the row.
    <div
      role="presentation"
      data-category-id={item.categoryId}
      className={cn(
        'border-b border-border/30 bg-card transition-colors select-none',
        isHighlighted && 'bg-primary/5',
        isSelected && 'bg-primary/10'
      )}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
    >
      {/* Table row */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 items-center py-1.5 pl-1 pr-2">
        {/* Category name column */}
        <div
          className="flex items-center gap-1 min-w-0 cursor-pointer"
          data-select-handle
          {...buttonizeProps((e) => {
            e.stopPropagation();
            onToggleExpand?.();
          })}
          aria-expanded={isExpanded}
        >
          <ChevronRight
            className={cn(
              'h-2.5 w-2.5 shrink-0 text-muted-foreground/40 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
          <span
            className={cn(
              'inline-flex h-1.5 w-1.5 shrink-0 rounded-full',
              getStatusDotClasses(statusColor)
            )}
          />
          <span className="text-[11px] truncate" title={item.name}>
            {item.name}
          </span>
        </div>

        {/* Allocated column */}
        <div className="text-right whitespace-nowrap" data-budget-prevent-row-select="true">
          <AllocatedCell
            item={item}
            globalLocalizer={globalLocalizer}
            onUpdateAssignment={onUpdateAssignment}
            onEditingChange={setIsEditingAllocated}
            inputAlign="right"
            placeholder="0"
            displayClassName={cn(
              'text-[11px] font-medium text-foreground tabular-nums',
              highlightAllocated && 'ring-1 ring-primary/60 bg-primary/10'
            )}
            inputClassName={cn(
              'h-5 text-[11px] text-right w-full',
              highlightAllocated && 'ring-1 ring-primary/60'
            )}
          />
        </div>

        {/* Available column */}
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
          className="flex items-center justify-end gap-0.5 whitespace-nowrap"
          triggerClassName="text-[11px] font-medium tabular-nums"
          fallbackClassName={cn(
            'text-[11px] font-medium tabular-nums',
            item.available < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
          )}
        />
      </div>

      {/* Expanded section - Activity, Goals, and Actions */}
      {isExpanded && (
        <div
          className={cn(
            'border-t border-border/30 bg-muted/20 px-2 py-1.5 text-[11px]',
            highlightGoalSection && 'ring-1 ring-primary/60 bg-primary/10'
          )}
        >
          {/* Activity row */}
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-muted-foreground">Activity</span>
            <ActivityButton
              item={item}
              globalLocalizer={globalLocalizer}
              onActivityClick={onActivityClick}
              className={cn(
                'flex items-center gap-1 font-medium transition-colors hover:text-primary',
                item.activity < 0
                  ? 'text-red-600 dark:text-red-400'
                  : item.activity > 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-foreground'
              )}
              iconClassName="h-2.5 w-2.5"
            />
          </div>

          {/* Actions row */}
          <div className="flex items-center justify-between gap-2 py-1 border-t border-border/20">
            <span className="text-muted-foreground">Actions</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => onEditCategory(item)}
              >
                <Edit3 className="h-3 w-3 mr-1" />
                Edit
              </Button>
              {onHideCategory && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHideCategory(item);
                  }}
                >
                  <EyeOff className="h-3 w-3 mr-1" />
                  Hide
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
                onClick={() => onDeleteCategory(item)}
              >
                <Trash className="h-3 w-3 mr-1" />
                Delete
              </Button>
            </div>
          </div>

          {/* Goal section */}
          <div className="pt-1 border-t border-border/20">
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
        </div>
      )}
    </div>
  );
}
