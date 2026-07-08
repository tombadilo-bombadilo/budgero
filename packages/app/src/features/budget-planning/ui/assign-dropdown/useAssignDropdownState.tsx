import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { useBatchUpsertAssignments } from '@entities/budget/api/useMonthlyBudget';
import { useCycleFinancialsForGoals } from '@entities/goal/api/useGoals';
import type { GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import { asMilli, formatMilli, type MilliUnits } from '@shared/lib/currency/milli';
import {
  calculateUnderfundedGoals,
  calculateOverspentCategories,
  calculateOverfundedCategories,
  calculateTotals,
  prepareUnderfundedAssignments,
  prepareOverspentAssignments,
  prepareOverfundedReductions,
  prepareResetAvailableAssignments,
  prepareResetAssignedAssignments,
  formatAssignmentDetails,
  formatReductionDetails,
  formatResetDetails,
  formatChangeDetails,
  type UnderfundedGoal,
  type OverspentCategory,
  type OverfundedCategory,
} from './assign-dropdown.utils';

export interface UseAssignDropdownStateProps {
  /** Ready-to-assign amount in integer milliunits. */
  readyToAssign: number;
  currentMonth: string;
  budgetId: number;
  budgetData: GetMonthlyBudgetRow[];
  goals: Goal[];
  globalLocalizer: Intl.NumberFormat;
  allowOverAssignment?: boolean;
}

export interface UseAssignDropdownStateReturn {
  isAssigning: boolean;
  underfundedGoals: UnderfundedGoal[];
  overspentCategories: OverspentCategory[];
  overfundedCategories: OverfundedCategory[];
  totalUnderfunded: MilliUnits;
  totalOverspent: MilliUnits;
  totalSafeReduction: MilliUnits;
  showReduceOnly: boolean;
  allowOverAssignment: boolean;
  handleAutoAssignUnderfunded: () => Promise<void>;
  handleCoverOverspending: () => Promise<void>;
  handleReduceOverfunding: () => Promise<void>;
  handleResetAvailable: () => Promise<void>;
  handleResetAssigned: () => Promise<void>;
}

export function useAssignDropdownState({
  readyToAssign,
  currentMonth,
  budgetId,
  budgetData,
  goals,
  globalLocalizer,
  allowOverAssignment = false,
}: UseAssignDropdownStateProps): UseAssignDropdownStateReturn {
  const batchUpsertAssignments = useBatchUpsertAssignments();
  const [isAssigning, setIsAssigning] = useState(false);

  const currencyCode = globalLocalizer.resolvedOptions().currency ?? 'USD';

  // Yearly/target-date goals need assignment history to compute cycle totals
  const { data: cycleFinancials } = useCycleFinancialsForGoals(goals, currentMonth);

  const underfundedGoals = useMemo(
    () => calculateUnderfundedGoals(goals, budgetData, currencyCode, currentMonth, cycleFinancials),
    [goals, budgetData, currencyCode, currentMonth, cycleFinancials]
  );

  const overspentCategories = useMemo(() => calculateOverspentCategories(budgetData), [budgetData]);

  const overfundedCategories = useMemo(
    () =>
      calculateOverfundedCategories(goals, budgetData, currencyCode, currentMonth, cycleFinancials),
    [goals, budgetData, currencyCode, currentMonth, cycleFinancials]
  );

  const { totalUnderfunded, totalOverspent, totalSafeReduction } = useMemo(
    () => calculateTotals(underfundedGoals, overspentCategories, overfundedCategories),
    [underfundedGoals, overspentCategories, overfundedCategories]
  );

  const showReduceOnly =
    readyToAssign <= 0 && overfundedCategories.length > 0 && !allowOverAssignment;

  const handleAutoAssignUnderfunded = useCallback(async () => {
    if (underfundedGoals.length === 0) {
      toast.success('No underfunded goals', {
        description: 'All goals are fully funded!',
      });
      return;
    }

    setIsAssigning(true);

    try {
      const { assignments, remaining, batchAssignments } = prepareUnderfundedAssignments(
        underfundedGoals,
        readyToAssign,
        budgetData
      );

      // Execute all assignments in a single batch (one op, one invalidation)
      await batchUpsertAssignments.mutateAsync(
        batchAssignments.map((a) => ({
          categoryId: a.categoryId,
          amount: a.amount,
          month: currentMonth,
          budgetId,
        }))
      );

      const { details, moreText } = formatAssignmentDetails(assignments, globalLocalizer);

      toast.success('Auto-assigned to goals', {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">
              Total: {formatMilli(globalLocalizer, asMilli(readyToAssign - remaining))}
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error('Assignment failed', {
        description: 'Failed to auto-assign to goals. Please try again.',
      });
    } finally {
      setIsAssigning(false);
    }
  }, [
    underfundedGoals,
    readyToAssign,
    budgetData,
    currentMonth,
    budgetId,
    globalLocalizer,
    batchUpsertAssignments,
  ]);

  const handleCoverOverspending = useCallback(async () => {
    if (overspentCategories.length === 0) {
      toast.success('No overspending', {
        description: 'No categories are overspent!',
      });
      return;
    }

    setIsAssigning(true);

    try {
      const { assignments, remaining, batchAssignments } = prepareOverspentAssignments(
        overspentCategories,
        readyToAssign,
        budgetData
      );

      // Execute all assignments in a single batch (one op, one invalidation)
      await batchUpsertAssignments.mutateAsync(
        batchAssignments.map((a) => ({
          categoryId: a.categoryId,
          amount: a.amount,
          month: currentMonth,
          budgetId,
        }))
      );

      const { details, moreText } = formatAssignmentDetails(assignments, globalLocalizer);

      toast.success('Covered overspending', {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">
              Total: {formatMilli(globalLocalizer, asMilli(readyToAssign - remaining))}
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error('Assignment failed', {
        description: 'Failed to cover overspending. Please try again.',
      });
    } finally {
      setIsAssigning(false);
    }
  }, [
    overspentCategories,
    readyToAssign,
    budgetData,
    currentMonth,
    budgetId,
    globalLocalizer,
    batchUpsertAssignments,
  ]);

  const handleReduceOverfunding = useCallback(async () => {
    if (overfundedCategories.length === 0) {
      toast.success('No overfunding', {
        description: 'No categories are overfunded!',
      });
      return;
    }

    setIsAssigning(true);

    try {
      const { reductions, totalReduced, batchAssignments } =
        prepareOverfundedReductions(overfundedCategories);

      await batchUpsertAssignments.mutateAsync(
        batchAssignments.map((a) => ({
          ...a,
          month: currentMonth,
          budgetId,
        }))
      );

      const { details, moreText } = formatReductionDetails(reductions, globalLocalizer);

      toast.success('Reduced overfunding', {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">
              Total freed up: {formatMilli(globalLocalizer, totalReduced)}
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error('Reduction failed', {
        description: 'Failed to reduce overfunding. Please try again.',
      });
    } finally {
      setIsAssigning(false);
    }
  }, [overfundedCategories, currentMonth, budgetId, globalLocalizer, batchUpsertAssignments]);

  const handleResetAvailable = useCallback(async () => {
    const categoriesToReset = budgetData.filter((row) => row.CategoryID > 0);

    if (categoriesToReset.length === 0) {
      toast.success('No categories to reset', {
        description: 'No categories found!',
      });
      return;
    }

    setIsAssigning(true);

    try {
      const { resets, batchAssignments } = prepareResetAvailableAssignments(budgetData);

      if (batchAssignments.length === 0) {
        toast.success('No changes needed', {
          description: 'All categories already have available amounts at zero!',
        });
        setIsAssigning(false);
        return;
      }

      await batchUpsertAssignments.mutateAsync(
        batchAssignments.map((a) => ({
          ...a,
          month: currentMonth,
          budgetId,
        }))
      );

      const { details, moreText, totalChange } = formatResetDetails(resets, globalLocalizer);
      const changedCount = resets.filter((r) => r.amount !== 0).length;

      toast.success('Reset available amounts to zero', {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">{changedCount} categories adjusted</div>
            <div className="text-xs text-muted-foreground">
              Net change: {totalChange >= 0 ? '+' : ''}
              {formatMilli(globalLocalizer, totalChange)}
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error('Reset failed', {
        description: 'Failed to reset available amounts. Please try again.',
      });
    } finally {
      setIsAssigning(false);
    }
  }, [budgetData, currentMonth, budgetId, globalLocalizer, batchUpsertAssignments]);

  const handleResetAssigned = useCallback(async () => {
    const categoriesToProcess = budgetData.filter((row) => row.CategoryID > 0);

    if (categoriesToProcess.length === 0) {
      toast.success('No categories to reset', {
        description: 'No categories found for this month.',
      });
      return;
    }

    setIsAssigning(true);

    try {
      const { changes, batchAssignments } = prepareResetAssignedAssignments(budgetData);

      await batchUpsertAssignments.mutateAsync(
        batchAssignments.map((a) => ({
          ...a,
          month: currentMonth,
          budgetId,
        }))
      );

      const { details, moreText, netChange } = formatChangeDetails(changes, globalLocalizer);

      toast.success('Reset assigned amounts', {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm text-muted-foreground">
              Net change: {netChange >= 0 ? '+' : ''}
              {formatMilli(globalLocalizer, netChange)}
            </div>
            {changes.length > 0 && (
              <div className="text-xs text-muted-foreground whitespace-pre-line">
                {details}
                {moreText}
              </div>
            )}
          </div>
        ),
      });
    } catch {
      toast.error('Reset failed', {
        description: 'Failed to reset assigned amounts. Please try again.',
      });
    } finally {
      setIsAssigning(false);
    }
  }, [budgetData, currentMonth, budgetId, globalLocalizer, batchUpsertAssignments]);

  return {
    isAssigning,
    underfundedGoals,
    overspentCategories,
    overfundedCategories,
    totalUnderfunded,
    totalOverspent,
    totalSafeReduction,
    showReduceOnly,
    allowOverAssignment,
    handleAutoAssignUnderfunded,
    handleCoverOverspending,
    handleReduceOverfunding,
    handleResetAvailable,
    handleResetAssigned,
  };
}
