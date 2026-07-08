/**
 * Available Cell Component
 *
 * The "Available" column cell shared by the category-row layout forks: a
 * 4-branch chain (CC-payment cover → move money → cover overspending → plain
 * amount) followed by the calculation-breakdown info popover. Layout-specific
 * styling comes in via className props; move-money state lives in
 * useCategoryRowState.
 *
 * The desktop table's DesktopBudgetCategoryRow deliberately keeps its own
 * divergent version (goal-aware colors, uncontrolled popover, raw Input).
 */

import { AnimatedNumber } from '@shared/ui/animated-number';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import { AvailableInfoPopover } from '@features/budget-planning/ui/AvailableInfoPopover';
import type { MilliUnits } from '@shared/lib/currency/milli';
import { MoveMoneyPopover } from './MoveMoneyPopover';
import { CCPaymentCoverPopover } from './CCPaymentCoverPopover';
import { CoverOverspendingPopover } from './CoverOverspendingPopover';

export interface AvailableCellProps {
  item: BudgetRow;
  globalLocalizer: Intl.NumberFormat;
  selectedBudgetId: number;
  currentMonth: string;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  // Move money state (from useCategoryRowState, or layout-local for the
  // desktop compact grid whose mobile twin shares the hook state)
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
  moveAmount: MilliUnits;
  setMoveAmount: (amount: MilliUnits) => void;
  moveTarget: number | null;
  setMoveTarget: (target: number | null) => void;
  initMovePopover: () => void;
  onConfirmMove: () => Promise<void>;
  /** Wrapper div classes — layout-specific. */
  className: string;
  /** Applied to the CC-payment / move-money / cover-overspending triggers. */
  triggerClassName?: string;
  /** Full class string for the plain AnimatedNumber fallback branch. */
  fallbackClassName: string;
  /** Optional extra wrapper around the amount (desktop compact grid). */
  amountWrapperClassName?: string;
}

export function AvailableCell({
  item,
  globalLocalizer,
  selectedBudgetId,
  currentMonth,
  onMoveMoney,
  moveOpen,
  setMoveOpen,
  moveAmount,
  setMoveAmount,
  moveTarget,
  setMoveTarget,
  initMovePopover,
  onConfirmMove,
  className,
  triggerClassName,
  fallbackClassName,
  amountWrapperClassName,
}: AvailableCellProps) {
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  const amount =
    item.available > 0 && item.fundingBreakdown !== undefined ? (
      <CCPaymentCoverPopover
        available={item.available}
        ccCategoryId={item.categoryId}
        budgetId={selectedBudgetId}
        globalLocalizer={globalLocalizer}
        triggerClassName={triggerClassName}
      />
    ) : item.available > 0 && onMoveMoney ? (
      <MoveMoneyPopover
        available={item.available}
        categoryId={item.categoryId}
        selectedBudgetId={selectedBudgetId}
        currentMonth={currentMonth}
        globalLocalizer={globalLocalizer}
        moveOpen={moveOpen}
        setMoveOpen={setMoveOpen}
        moveAmount={moveAmount}
        setMoveAmount={setMoveAmount}
        moveTarget={moveTarget}
        setMoveTarget={setMoveTarget}
        onConfirmMove={onConfirmMove}
        initMovePopover={initMovePopover}
        triggerClassName={triggerClassName}
      />
    ) : item.available < 0 && onMoveMoney ? (
      <CoverOverspendingPopover
        available={item.available}
        categoryId={item.categoryId}
        budgetId={selectedBudgetId}
        month={currentMonth}
        globalLocalizer={globalLocalizer}
        onMoveMoney={onMoveMoney}
        triggerClassName={triggerClassName}
      />
    ) : (
      <AnimatedNumber
        value={item.available}
        formatter={formatAmount}
        className={fallbackClassName}
      />
    );

  return (
    <div className={className}>
      {amountWrapperClassName ? <div className={amountWrapperClassName}>{amount}</div> : amount}
      <AvailableInfoPopover
        item={item}
        globalLocalizer={globalLocalizer}
        triggerSize="sm"
        side="top"
        align="center"
        amountBoxBg="muted/50"
        amountRowGap="space-y-1"
        availableLabel="Total available:"
        showHelp
        month={currentMonth}
        budgetId={selectedBudgetId}
      />
    </div>
  );
}
