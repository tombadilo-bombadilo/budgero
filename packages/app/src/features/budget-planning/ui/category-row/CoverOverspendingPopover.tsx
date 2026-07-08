import { useCallback, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { cn } from '@shared/lib/utils';
import { asMilli, fromDecimal, toDecimal, type MilliUnits } from '@shared/lib/currency/milli';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { toastError } from '@shared/lib/errors';
import {
  useMonthlyBudget,
  useReadyToAssign,
  useBatchUpsertAssignments,
} from '@entities/budget/api/useMonthlyBudget';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';

export interface CoverOverspendingPopoverProps {
  /** The overspent category's available balance (negative), in milliunits. */
  available: MilliUnits;
  categoryId: number;
  budgetId: number;
  month: string;
  globalLocalizer: Intl.NumberFormat;
  onMoveMoney: (
    sourceCategoryId: number,
    amount: MilliUnits,
    target: number | 'rta'
  ) => Promise<void>;
  align?: 'start' | 'center' | 'end';
  triggerClassName?: string;
}

/**
 * Popover on a negative Available amount that moves assignment from a donor
 * category to cover the overspending. The cover amount is capped at the
 * donor's available balance so covering never puts the donor in the red.
 */
export function CoverOverspendingPopover({
  available,
  categoryId,
  budgetId,
  month,
  globalLocalizer,
  onMoveMoney,
  align = 'end',
  triggerClassName,
}: CoverOverspendingPopoverProps) {
  const amountInputId = useId();
  const [open, setOpen] = useState(false);
  const [sourceCategoryId, setSourceCategoryId] = useState<number | null>(null);
  // Decimal string state (raw <Input type="number">); converts to milliunits
  // via fromDecimal exactly once, in handleCover.
  const [amount, setAmount] = useState<string>('');
  const [isCovering, setIsCovering] = useState(false);

  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  const overspent = asMilli(Math.max(0, 0 - (available || 0)));

  // Donor balances for capping; the queries are already warm from the table.
  // Source id 0 means Ready to Assign.
  const { data: monthlyRows = [] } = useMonthlyBudget(month, budgetId);
  const { data: readyToAssign = 0 } = useReadyToAssign(budgetId);
  const batchUpsertAssignments = useBatchUpsertAssignments();
  const donorAvailableFor = useCallback(
    (id: number) => {
      if (id === 0) return asMilli(Math.max(0, readyToAssign));
      const row = monthlyRows.find((r) => r.CategoryID === id);
      return asMilli(Math.max(0, row?.Available ?? 0));
    },
    [monthlyRows, readyToAssign]
  );
  const sourceAvailable = useMemo(
    () => (sourceCategoryId === null ? 0 : donorAvailableFor(sourceCategoryId)),
    [donorAvailableFor, sourceCategoryId]
  );

  // Never take more than the donor has, never more than the overspending
  const maxCover = asMilli(Math.min(overspent, sourceAvailable));

  const parsedAmount = parseFloat(amount);
  const canCover =
    sourceCategoryId !== null &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    fromDecimal(parsedAmount) <= maxCover &&
    !isCovering;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSourceCategoryId(null);
      setAmount(String(toDecimal(overspent)));
    }
    setOpen(next);
  };

  const handleSourceSelect = (id: number) => {
    setSourceCategoryId(id);
    setAmount(String(toDecimal(asMilli(Math.min(overspent, donorAvailableFor(id))))));
  };

  const handleCover = async () => {
    if (!canCover || sourceCategoryId === null) return;
    const cover = fromDecimal(parsedAmount);
    setIsCovering(true);
    try {
      if (sourceCategoryId === 0) {
        // Covering from Ready to Assign is not a category-to-category move —
        // just assign more to the overspent category.
        const targetAssigned = monthlyRows.find((r) => r.CategoryID === categoryId)?.Assigned ?? 0;
        try {
          await batchUpsertAssignments.mutateAsync([
            { categoryId, amount: targetAssigned + cover, month, budgetId },
          ]);
          toast.success('Overspending covered', {
            description: `Assigned ${formatAmount(cover)} from Ready to Assign.`,
          });
        } catch (error) {
          toastError('Cover failed', error, 'Please try again.');
          return;
        }
      } else {
        // onMoveMoney validates, warns about future overspending, and toasts
        await onMoveMoney(sourceCategoryId, cover, categoryId);
      }
      setOpen(false);
    } finally {
      setIsCovering(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'underline decoration-dotted underline-offset-2 text-red-600 dark:text-red-300 focus:outline-none',
            triggerClassName
          )}
          title="Cover overspending"
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatedNumber value={available} formatter={formatAmount} className="tabular-nums" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align={align}>
        <div className="text-sm font-medium">Cover Overspending</div>
        <div className="text-xs text-muted-foreground">
          Overspent by <span className="font-medium text-red-600">{formatAmount(overspent)}</span>
        </div>
        <div className="space-y-1">
          {/* Caption, not a <label>: SearchableCategorySelect exposes no labelable control. */}
          <span className="text-xs text-muted-foreground">Cover from</span>
          <SearchableCategorySelect
            budgetId={budgetId}
            selectedCategoryId={sourceCategoryId}
            onCategorySelect={handleSourceSelect}
            placeholder="Select source category"
            triggerClassName="justify-start h-8 w-full"
            includeReadyToAssign
            excludeCategoryId={categoryId}
            showAvailableForMonth
            onlyPositiveAvailable
            month={month}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={amountInputId} className="font-normal text-xs text-muted-foreground">
            Amount
          </Label>
          <Input
            id={amountInputId}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            max={String(toDecimal(maxCover))}
            disabled={sourceCategoryId === null}
          />
          {sourceCategoryId !== null && (
            <div className="text-[11px] text-muted-foreground">
              Max {formatAmount(maxCover)} — covering never puts the source in the red
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCover} disabled={!canCover}>
            {isCovering ? 'Covering…' : 'Cover'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
