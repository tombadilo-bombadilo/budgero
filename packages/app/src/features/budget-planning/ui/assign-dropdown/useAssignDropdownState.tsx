import { Trans, useLingui } from '@lingui/react/macro';
import { track } from '@shared/lib/analytics/track';
import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { useBatchUpsertAssignments } from '@entities/budget/api/useMonthlyBudget';
import { useGoalFundingSettings } from '@entities/budget/api/useGoalFundingSettings';
import { useGoals, useCycleFinancialsForGoals } from '@entities/goal/api/useGoals';
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
  fundingReady: boolean;
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
  const { t } = useLingui();

  const batchUpsertAssignments = useBatchUpsertAssignments();
  const [isAssigning, setIsAssigning] = useState(false);

  const currencyCode = globalLocalizer.resolvedOptions().currency ?? 'USD';

  // Yearly/target-date goals need assignment history to compute cycle totals
  const settings = useGoalFundingSettings(budgetId);
  const goalsQuery = useGoals(budgetId);
  const cycleQuery = useCycleFinancialsForGoals(goals, currentMonth);
  const cycleFinancials = cycleQuery.data;
  const needsCycles = goals.some((goal) => goal.Type === 'yearly' || goal.Type === 'target-date');
  const fundingReady =
    settings.isReady &&
    goalsQuery.isSuccess &&
    !goalsQuery.isFetching &&
    (!needsCycles || (cycleQuery.isSuccess && !cycleQuery.isFetching));

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
    if (!fundingReady) return;
    if (underfundedGoals.length === 0) {
      toast.success(t`No underfunded goals`, {
        description: t`All goals are fully funded!`,
      });
      return;
    }

    setIsAssigning(true);

    try {
      const allowance = allowOverAssignment ? totalUnderfunded : Math.max(0, readyToAssign);
      const { assignments, remaining, batchAssignments } = prepareUnderfundedAssignments(
        underfundedGoals,
        allowance,
        budgetData,
        settings.GoalFundingDistribution
      );
      if (!batchAssignments.length) return;

      // Execute all assignments in a single batch (one op, one invalidation)
      await batchUpsertAssignments.mutateAsync(
        batchAssignments.map((a) => ({
          categoryId: a.categoryId,
          amount: a.amount,
          month: currentMonth,
          budgetId,
        }))
      );

      track('goal_funded', { method: 'auto_assign_underfunded' });
      const { details, moreText } = formatAssignmentDetails(assignments, globalLocalizer);

      toast.success(t`Auto-assigned to goals`, {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">
              <Trans>Total: {formatMilli(globalLocalizer, asMilli(allowance - remaining))}</Trans>
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error(t`Assignment failed`, {
        description: t`Failed to auto-assign to goals. Please try again.`,
      });
    } finally {
      setIsAssigning(false);
    }
  }, [
    fundingReady,
    allowOverAssignment,
    totalUnderfunded,
    settings.GoalFundingDistribution,
    underfundedGoals,
    readyToAssign,
    budgetData,
    currentMonth,
    budgetId,
    globalLocalizer,
    batchUpsertAssignments,
    t,
  ]);

  const handleCoverOverspending = useCallback(async () => {
    if (overspentCategories.length === 0) {
      toast.success(t`No overspending`, {
        description: t`No categories are overspent!`,
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

      toast.success(t`Covered overspending`, {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">
              <Trans>
                Total: {formatMilli(globalLocalizer, asMilli(readyToAssign - remaining))}
              </Trans>
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error(t`Assignment failed`, {
        description: t`Failed to cover overspending. Please try again.`,
      });
    } finally {
      setIsAssigning(false);
    }
  }, [
    t,
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
      toast.success(t`No overfunding`, {
        description: t`No categories are overfunded!`,
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

      toast.success(t`Reduced overfunding`, {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">
              <Trans>Total freed up: {formatMilli(globalLocalizer, totalReduced)}</Trans>
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error(t`Reduction failed`, {
        description: t`Failed to reduce overfunding. Please try again.`,
      });
    } finally {
      setIsAssigning(false);
    }
  }, [overfundedCategories, currentMonth, budgetId, globalLocalizer, batchUpsertAssignments, t]);

  const handleResetAvailable = useCallback(async () => {
    const categoriesToReset = budgetData.filter((row) => row.CategoryID > 0);

    if (categoriesToReset.length === 0) {
      toast.success(t`No categories to reset`, {
        description: t`No categories found!`,
      });
      return;
    }

    setIsAssigning(true);

    try {
      const { resets, batchAssignments } = prepareResetAvailableAssignments(budgetData);

      if (batchAssignments.length === 0) {
        toast.success(t`No changes needed`, {
          description: t`All categories already have available amounts at zero!`,
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

      toast.success(t`Reset available amounts to zero`, {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm font-medium">
              <Trans>{changedCount} categories adjusted</Trans>
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans>
                Net change: {totalChange >= 0 ? '+' : ''}
                {formatMilli(globalLocalizer, totalChange)}
              </Trans>
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {details}
              {moreText}
            </div>
          </div>
        ),
      });
    } catch {
      toast.error(t`Reset failed`, {
        description: t`Failed to reset available amounts. Please try again.`,
      });
    } finally {
      setIsAssigning(false);
    }
  }, [budgetData, currentMonth, budgetId, globalLocalizer, batchUpsertAssignments, t]);

  const handleResetAssigned = useCallback(async () => {
    const categoriesToProcess = budgetData.filter((row) => row.CategoryID > 0);

    if (categoriesToProcess.length === 0) {
      toast.success(t`No categories to reset`, {
        description: t`No categories found for this month.`,
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

      toast.success(t`Reset assigned amounts`, {
        description: (
          <div className="mt-2 space-y-1">
            <div className="text-sm text-muted-foreground">
              <Trans>
                Net change: {netChange >= 0 ? '+' : ''}
                {formatMilli(globalLocalizer, netChange)}
              </Trans>
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
      toast.error(t`Reset failed`, {
        description: t`Failed to reset assigned amounts. Please try again.`,
      });
    } finally {
      setIsAssigning(false);
    }
  }, [budgetData, currentMonth, budgetId, globalLocalizer, batchUpsertAssignments, t]);

  return {
    fundingReady,
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
