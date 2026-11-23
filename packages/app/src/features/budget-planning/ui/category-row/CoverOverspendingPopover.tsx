import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
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
import { PlanningAnimatedNumber } from '@features/budget-planning/ui/PlanningNumberAnimation';

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
  /** 'amber' for credit overspend (debt, not lost cash), 'red' for cash. */
  tone?: 'red' | 'amber';
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
  tone = 'red',
}: CoverOverspendingPopoverProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const formatAmount = useFormatMaskedMilli(globalLocalizer);
  const overspent = asMilli(Math.max(0, 0 - (available || 0)));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'underline decoration-dotted underline-offset-2 focus:outline-none',
            tone === 'amber'
              ? 'text-amber-600 dark:text-amber-300'
              : 'text-red-600 dark:text-red-300',
            triggerClassName
          )}
          title={
            tone === 'amber' ? t`Credit overspend — cover to avoid debt` : t`Cover overspending`
          }
          onClick={(e) => e.stopPropagation()}
        >
          <PlanningAnimatedNumber
            value={available}
            formatter={formatAmount}
            className="tabular-nums"
          />
        </button>
      </PopoverTrigger>
      {open && (
        <CoverOverspendingEditor
          overspent={overspent}
          categoryId={categoryId}
          budgetId={budgetId}
          month={month}
          globalLocalizer={globalLocalizer}
          onMoveMoney={onMoveMoney}
          onClose={() => setOpen(false)}
          align={align}
          tone={tone}
        />
      )}
    </Popover>
  );
}

interface CoverOverspendingEditorProps {
  overspent: MilliUnits;
  categoryId: number;
  budgetId: number;
  month: string;
  globalLocalizer: Intl.NumberFormat;
  onMoveMoney: CoverOverspendingPopoverProps['onMoveMoney'];
  onClose: () => void;
  align: NonNullable<CoverOverspendingPopoverProps['align']>;
  tone: NonNullable<CoverOverspendingPopoverProps['tone']>;
}

/** Mount query subscriptions and mutation state only while the popover is open. */
function CoverOverspendingEditor({
  overspent,
  categoryId,
  budgetId,
  month,
  globalLocalizer,
  onMoveMoney,
  onClose,
  align,
  tone,
}: CoverOverspendingEditorProps) {
  const { t } = useLingui();

  const amountInputId = useId();
  const [sourceCategoryId, setSourceCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState(() => String(toDecimal(overspent)));
  const [isCovering, setIsCovering] = useState(false);
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  // Source id 0 means Ready to Assign. These subscriptions are deliberately
  // absent from every closed row in the budget table.
  const { data: monthlyRows = [] } = useMonthlyBudget(month, budgetId);
  const { data: readyToAssign = 0 } = useReadyToAssign(budgetId);
  const batchUpsertAssignments = useBatchUpsertAssignments();
  const donorAvailableFor = useCallback(
    (id: number) => {
      if (id === 0) return asMilli(Math.max(0, readyToAssign));
      const row = monthlyRows.find((candidate) => candidate.CategoryID === id);
      return asMilli(Math.max(0, row?.Available ?? 0));
    },
    [monthlyRows, readyToAssign]
  );
  const sourceAvailable = useMemo(
    () => (sourceCategoryId === null ? 0 : donorAvailableFor(sourceCategoryId)),
    [donorAvailableFor, sourceCategoryId]
  );
  const maxCover = asMilli(Math.min(overspent, sourceAvailable));
  const parsedAmount = parseFloat(amount);
  const canCover =
    sourceCategoryId !== null &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    fromDecimal(parsedAmount) <= maxCover &&
    !isCovering;

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
        const targetAssigned =
          monthlyRows.find((row) => row.CategoryID === categoryId)?.Assigned ?? 0;
        try {
          await batchUpsertAssignments.mutateAsync([
            { categoryId, amount: targetAssigned + cover, month, budgetId },
          ]);
          toast.success(t`Overspending covered`, {
            description: t`Assigned ${formatAmount(cover)} from Ready to Assign.`,
          });
        } catch (error) {
          toastError('Cover failed', error, 'Please try again.');
          return;
        }
      } else {
        await onMoveMoney(sourceCategoryId, cover, categoryId);
      }
      onClose();
    } finally {
      setIsCovering(false);
    }
  };

  return (
    <PopoverContent className="w-72 space-y-3" align={align}>
      <div className="text-sm font-medium">
        <Trans>Cover Overspending</Trans>
      </div>
      <div className="text-xs text-muted-foreground">
        {tone === 'amber' ? t`Overspent on credit by ` : t`Overspent by `}
        <span className={cn('font-medium', tone === 'amber' ? 'text-amber-600' : 'text-red-600')}>
          {formatAmount(overspent)}
        </span>
        {tone === 'amber' && t` — cover it to avoid creating debt.`}
      </div>
      <div className="space-y-1">
        {/* Caption, not a <label>: SearchableCategorySelect exposes no labelable control. */}
        <span className="text-xs text-muted-foreground">
          <Trans>Cover from</Trans>
        </span>
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
          <Trans>Amount</Trans>
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
          <div className="text-[0.6875rem] text-muted-foreground">
            <Trans>Max {formatAmount(maxCover)} — covering never puts the source in the red</Trans>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button size="sm" onClick={handleCover} disabled={!canCover}>
          {isCovering ? t`Covering…` : t`Cover`}
        </Button>
      </div>
    </PopoverContent>
  );
}
