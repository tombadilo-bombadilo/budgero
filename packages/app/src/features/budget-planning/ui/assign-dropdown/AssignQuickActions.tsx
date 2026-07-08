import { DropdownMenuItem, DropdownMenuSeparator } from '@shared/ui/dropdown-menu';
import { Target, AlertTriangle, TrendingDown, RotateCcw, RefreshCw } from 'lucide-react';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { asMilli, formatMilli, type MilliUnits } from '@shared/lib/currency/milli';
import {
  getResetAvailableCounts,
  getResetAssignedCounts,
  type UnderfundedGoal,
  type OverspentCategory,
  type OverfundedCategory,
} from './assign-dropdown.utils';

interface AssignQuickActionsProps {
  /** Ready-to-assign amount in integer milliunits. */
  readyToAssign: number;
  isAssigning: boolean;
  underfundedGoals: UnderfundedGoal[];
  overspentCategories: OverspentCategory[];
  overfundedCategories: OverfundedCategory[];
  totalUnderfunded: MilliUnits;
  totalOverspent: MilliUnits;
  totalSafeReduction: MilliUnits;
  budgetData: GetMonthlyBudgetRow[];
  globalLocalizer: Intl.NumberFormat;
  allowOverAssignment?: boolean;
  onAutoAssignUnderfunded: () => void;
  onCoverOverspending: () => void;
  onReduceOverfunding: () => void;
  onResetAvailable: () => void;
  onResetAssigned: () => void;
}

export function AssignQuickActions({
  readyToAssign,
  isAssigning,
  underfundedGoals,
  overspentCategories,
  overfundedCategories,
  totalUnderfunded,
  totalOverspent,
  totalSafeReduction,
  budgetData,
  globalLocalizer,
  allowOverAssignment = false,
  onAutoAssignUnderfunded,
  onCoverOverspending,
  onReduceOverfunding,
  onResetAvailable,
  onResetAssigned,
}: AssignQuickActionsProps) {
  const { nonZeroCount, overspentCount, overfundedCount } = getResetAvailableCounts(budgetData);
  const { count: resetAssignedCount, totalAbs: resetAssignedTotal } =
    getResetAssignedCounts(budgetData);

  return (
    <>
      <DropdownMenuItem
        onClick={onAutoAssignUnderfunded}
        disabled={
          underfundedGoals.length === 0 ||
          (readyToAssign <= 0 && !allowOverAssignment) ||
          isAssigning
        }
        className="flex items-center gap-2"
      >
        <Target className="h-4 w-4" />
        <div className="flex-1">
          <div className="font-medium">Fund Goals</div>
          <div className="text-xs text-muted-foreground">
            {underfundedGoals.length === 0
              ? 'All goals funded'
              : `${underfundedGoals.length} goal${underfundedGoals.length === 1 ? '' : 's'} need ${formatMilli(globalLocalizer, asMilli(Math.min(totalUnderfunded, readyToAssign)))}`}
          </div>
        </div>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={onCoverOverspending}
        disabled={
          overspentCategories.length === 0 ||
          (readyToAssign <= 0 && !allowOverAssignment) ||
          isAssigning
        }
        className="flex items-center gap-2"
      >
        <AlertTriangle className="h-4 w-4" />
        <div className="flex-1">
          <div className="font-medium">Cover Overspending</div>
          <div className="text-xs text-muted-foreground">
            {overspentCategories.length === 0
              ? 'No overspending'
              : `${overspentCategories.length} categor${overspentCategories.length === 1 ? 'y' : 'ies'} need ${formatMilli(globalLocalizer, asMilli(Math.min(totalOverspent, readyToAssign)))}`}
          </div>
        </div>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        onClick={onReduceOverfunding}
        disabled={overfundedCategories.length === 0 || isAssigning}
        className="flex items-center gap-2"
      >
        <TrendingDown className="h-4 w-4" />
        <div className="flex-1">
          <div className="font-medium">Reduce Overfunding</div>
          <div className="text-xs text-muted-foreground">
            {overfundedCategories.length === 0
              ? 'No overfunding'
              : `Free up ${formatMilli(globalLocalizer, totalSafeReduction)} from ${overfundedCategories.length} categor${overfundedCategories.length === 1 ? 'y' : 'ies'}`}
          </div>
        </div>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        onClick={onResetAvailable}
        disabled={isAssigning}
        className="flex items-center gap-2"
      >
        <RotateCcw className="h-4 w-4" />
        <div className="flex-1">
          <div className="font-medium">Reset Available to Zero</div>
          <div className="text-xs text-muted-foreground">
            {(() => {
              if (nonZeroCount === 0) {
                return 'All categories already at zero';
              }
              const parts = [];
              if (overspentCount > 0) parts.push(`${overspentCount} overspent`);
              if (overfundedCount > 0) parts.push(`${overfundedCount} with surplus`);
              return `Adjust ${nonZeroCount} categor${nonZeroCount === 1 ? 'y' : 'ies'} (${parts.join(', ')})`;
            })()}
          </div>
        </div>
      </DropdownMenuItem>

      <DropdownMenuItem
        onClick={onResetAssigned}
        disabled={resetAssignedCount === 0 || isAssigning}
        className="flex items-center gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        <div className="flex-1">
          <div className="font-medium">Reset Assigned Amounts</div>
          <div className="text-xs text-muted-foreground">
            {resetAssignedCount === 0
              ? 'All assignments already zero'
              : `Reset ${formatMilli(globalLocalizer, resetAssignedTotal)} across ${resetAssignedCount} categor${resetAssignedCount === 1 ? 'y' : 'ies'}`}
          </div>
        </div>
      </DropdownMenuItem>
    </>
  );
}
