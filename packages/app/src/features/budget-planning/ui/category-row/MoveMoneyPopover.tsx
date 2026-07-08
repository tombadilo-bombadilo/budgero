import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { cn } from '@shared/lib/utils';
import { availableAmountClass } from '@shared/lib/amount-color';
import { type MilliUnits } from '@shared/lib/currency/milli';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { isMoveValid } from './category-row.utils';

export interface MoveMoneyPopoverProps {
  available: MilliUnits;
  categoryId: number;
  selectedBudgetId: number;
  currentMonth: string;
  globalLocalizer: Intl.NumberFormat;
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
  moveAmount: MilliUnits;
  setMoveAmount: (amount: MilliUnits) => void;
  moveTarget: number | null;
  setMoveTarget: (target: number | null) => void;
  onConfirmMove: () => Promise<void>;
  initMovePopover: () => void;
  className?: string;
  align?: 'start' | 'center' | 'end';
  triggerClassName?: string;
}

export function MoveMoneyPopover({
  available,
  categoryId,
  selectedBudgetId,
  currentMonth,
  globalLocalizer,
  moveOpen,
  setMoveOpen,
  moveAmount,
  setMoveAmount,
  moveTarget,
  setMoveTarget,
  onConfirmMove,
  initMovePopover,
  className,
  align = 'end',
  triggerClassName,
}: MoveMoneyPopoverProps) {
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  const handleOpenChange = (open: boolean) => {
    setMoveOpen(open);
    if (open) {
      initMovePopover();
    }
  };

  return (
    <Popover open={moveOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'underline decoration-dotted underline-offset-2 hover:text-primary focus:outline-none',
            availableAmountClass(available),
            triggerClassName
          )}
          title="Move money"
          onClick={(e) => {
            e.stopPropagation();
            setMoveOpen(true);
          }}
        >
          {formatAmount(available)}
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-72 p-3', className)} align={align}>
        <div className="space-y-3">
          <div className="text-sm font-medium">Move Money</div>
          <div className="space-y-1">
            {/* Caption, not a <label>: CalculatorCell exposes no labelable control. */}
            <span className="text-xs text-muted-foreground">Amount</span>
            <CalculatorCell
              value={moveAmount}
              onCommit={setMoveAmount}
              formatter={globalLocalizer.format}
              localizer={globalLocalizer}
              placeholder="0.00"
              zeroAsEmpty
              inputAlign="left"
              displayClassName="h-9 flex items-center rounded-md border border-input bg-background px-3 text-sm"
              inputClassName="h-9"
            />
            <div className="text-[10px] text-muted-foreground">
              Available: {formatAmount(Math.max(0, available || 0))}
            </div>
          </div>
          <div className="space-y-1">
            {/* Caption, not a <label>: SearchableCategorySelect exposes no labelable control. */}
            <span className="text-xs text-muted-foreground">Move to</span>
            <SearchableCategorySelect
              budgetId={selectedBudgetId}
              selectedCategoryId={moveTarget}
              onCategorySelect={(id) => setMoveTarget(id)}
              placeholder="Select target"
              triggerClassName="h-8 w-full justify-start"
              popoverContentClassName="w-72"
              includeReadyToAssign
              excludeCategoryId={categoryId}
              showAvailableForMonth
              month={currentMonth}
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onConfirmMove}
              disabled={!isMoveValid(moveAmount, available, moveTarget)}
            >
              Move
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
