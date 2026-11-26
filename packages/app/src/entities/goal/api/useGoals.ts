import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import {
  GoalPurpose,
  GoalType,
  resolveGoalsForMonth,
  type Goal,
  type GoalRateSource,
  type MilliUnits,
  type Services,
  CategoryFinancials,
} from '@budgero/core/browser';
import { getTodayISO } from '@shared/lib/date-utils';

const NO_GOALS: Goal[] = [];

/** How often goal reads may try to fetch a missing exchange rate (per space). */
const RATE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const lastRateRefresh = new Map<string, number>();

/**
 * Goals with a target in another currency convert at today's rate from the
 * budget's rate cache. Before reading them, fetch today's rate for each such
 * currency when the cache has none from the last week (at most every few
 * minutes; offline it simply keeps the rates it has).
 */
async function refreshGoalRates(services: Services, spaceId: string): Promise<void> {
  const pairs = services.goals.getForeignGoalCurrencies?.() ?? [];
  if (pairs.length === 0) return;
  const now = Date.now();
  if (now - (lastRateRefresh.get(spaceId) ?? 0) < RATE_REFRESH_INTERVAL_MS) return;
  lastRateRefresh.set(spaceId, now);
  const today = getTodayISO();
  await Promise.all(
    pairs.map((pair) =>
      services.currency
        .getOrFetchRate(pair.currency, pair.budgetCurrency, today, pair.budgetId)
        .catch(() => null)
    )
  );
}

/**
 * Fetch every goal row of a budget: all timeframes of every category. A
 * category can have several; anything evaluating a month uses
 * useGoalsForMonth (or resolveGoalsForMonth) instead.
 */
export function useGoals(budgetId: number) {
  return useSpaceQuery<Goal[]>({
    key: ['goals', budgetId],
    enabled: budgetId > 0,
    queryFn: async (services, spaceId) => {
      await refreshGoalRates(services, spaceId);
      try {
        return services.goals.getAllGoals();
      } catch (error) {
        console.error('Error fetching goals:', error);
        return [];
      }
    },
  });
}

/** Each category's goal that applies in `month` (YYYY-MM), from the useGoals rows. */
export function useGoalsForMonth(budgetId: number, month: string) {
  const query = useGoals(budgetId);
  const all = query.data ?? NO_GOALS;
  const data = useMemo(() => resolveGoalsForMonth(all, month), [all, month]);
  return { ...query, data, allGoals: all };
}

/** Every timeframe of one category's goal, in chain order. */
export function useGoalTimeframes(categoryId: number) {
  return useSpaceQuery<Goal[]>({
    key: ['goalTimeframes', categoryId],
    enabled: Boolean(categoryId),
    queryFn: async (services, spaceId) => {
      await refreshGoalRates(services, spaceId);
      try {
        return services.goals.getGoalTimeframes(categoryId);
      } catch {
        return [];
      }
    },
  });
}

export type CreateGoalInput = {
  type: GoalType;
  purpose?: GoalPurpose;
  categoryId: number;
  target: number;
  startDate: string;
  targetDate: string;
  recurring?: boolean;
  /** Cadence in months for recurring goals; null/undefined = yearly default. */
  cycleMonths?: number | null;
  /** First month of the timeframe; omitted = StartDate's month. */
  effectiveFrom?: string | null;
  /** Last month (inclusive); omitted = ongoing. */
  effectiveTo?: string | null;
  /** Currency of `target`; null/omitted = the budget currency. */
  targetCurrency?: string | null;
  budgetId: number; // Added for invalidation
};

/** These categories' goals that apply in `month` (YYYY-MM). */
export function useGoalsByCategories(categoryIds: number[], month: string) {
  return useSpaceQuery<Goal[] | null>({
    key: ['goals', 'list', categoryIds.join('_'), month],
    enabled: categoryIds.length > 0,
    queryFn: async (services, spaceId) => {
      await refreshGoalRates(services, spaceId);
      try {
        return services.goals.getGoalsByCategoryIDs(categoryIds, month);
      } catch (error) {
        console.error('Error fetching goals for categories:', error);
        return null;
      }
    },
  });
}

export function useCreateGoal() {
  const runtime = useRuntime();

  return useMutation<number, Error, CreateGoalInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<number>(runtime, {
        op: 'goals.create',
        payload: {
          goalType: input.type,
          purpose: input.purpose || GoalPurpose.SPENDING,
          categoryId: input.categoryId,
          target: input.target,
          startDate: input.startDate,
          endDate: input.targetDate,
          recurring: input.recurring ?? false,
          cycleMonths: input.cycleMonths ?? null,
          ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
          ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}),
          targetCurrency: input.targetCurrency ?? null,
          budgetId: input.budgetId,
        },
        meta: { label: 'useCreateGoal' },
      });
    },
  });
}

/**
 * Fetch complete category financials for goal calculations.
 * Uses GoalService.getCategoryFinancials() which fetches historical assignments,
 * historical activity, and planned assignments in a single synchronous call.
 */
export function useCategoryFinancials(
  categoryId: number,
  currentMonth: string,
  budgetRow?: { Available: number; Assigned: number; Activity: number }
) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  return useQuery<CategoryFinancials>({
    queryKey: [
      'categoryFinancials',
      spaceKey,
      categoryId,
      currentMonth,
      budgetRow?.Assigned,
      budgetRow?.Available,
      budgetRow?.Activity,
    ],
    queryFn: async () => {
      const services = runtime.services();
      return services.goals.getCategoryFinancials(
        categoryId,
        currentMonth,
        budgetRow as Parameters<typeof services.goals.getCategoryFinancials>[2]
      );
    },
    enabled: Boolean(spaceId) && Boolean(categoryId) && Boolean(currentMonth),
  });
}

/**
 * Fetch cycle financials (historical + planned assignments) for goals whose
 * progress spans multiple months. Yearly and target-date goals sum assignments
 * across their whole cycle, so computing their progress from only the current
 * month's row silently undercounts — this map supplies the missing history.
 * Monthly goal types don't need it and are skipped.
 *
 * Keyed under 'monthlyBudget' so assignment mutations' broad invalidation
 * refetches it.
 */
export function useCycleFinancialsForGoals(goals: Goal[] | null | undefined, currentMonth: string) {
  const cycleCategoryIds = useMemo(
    () =>
      resolveGoalsForMonth(goals ?? [], currentMonth)
        .filter((g) => g.Type === GoalType.YEARLY || g.Type === GoalType.TARGET_DATE)
        .map((g) => g.CategoryID)
        .sort((a, b) => a - b),
    [goals, currentMonth]
  );

  return useSpaceQuery<Record<number, CategoryFinancials>>({
    key: ['monthlyBudget', 'cycleFinancials', currentMonth, cycleCategoryIds.join(',')],
    enabled: cycleCategoryIds.length > 0 && Boolean(currentMonth),
    queryFn: (services) => {
      const map: Record<number, CategoryFinancials> = {};
      for (const categoryId of cycleCategoryIds) {
        // Without a budget row this returns zeros for the current month plus
        // historical/planned assignments — callers merge in live row values.
        map[categoryId] = services.goals.getCategoryFinancials(categoryId, currentMonth);
      }
      return map;
    },
  });
}

/**
 * The category's goal that applies in `month` (YYYY-MM)
 */
export function useGoalByCategory(categoryId: number, month: string) {
  return useSpaceQuery<Goal | null>({
    key: ['goal', categoryId, month],
    enabled: Boolean(categoryId),
    queryFn: async (services, spaceId) => {
      await refreshGoalRates(services, spaceId);
      try {
        return services.goals.getGoalByCategoryID(categoryId, month);
      } catch {
        // If no goal exists, return null instead of throwing
        return null;
      }
    },
  });
}

export type UpdateGoalInput = {
  categoryId: number;
  target: number;
  type: GoalType;
  purpose?: GoalPurpose;
  targetDate: string;
  recurring?: boolean;
  /**
   * Cadence in months. `null` clears to the yearly default; omit (undefined)
   * to leave the stored value untouched (e.g. non-date presets).
   */
  cycleMonths?: number | null;
  /** New start date (YYYY-MM-DD); omit to keep the stored one. */
  startDate?: string | null;
  /** The timeframe to update (its first month). */
  effectiveFrom: string;
  /** Currency of `target`; null/omitted = the budget currency. */
  targetCurrency?: string | null;
  budgetId: number; // Added for invalidation
};

export function useUpdateGoal() {
  const runtime = useRuntime();

  return useMutation<void, Error, UpdateGoalInput>({
    mutationFn: async (input) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'goals.update',
        payload: {
          categoryId: input.categoryId,
          target: input.target,
          goalType: input.type,
          purpose: input.purpose || GoalPurpose.SPENDING,
          endDate: input.targetDate,
          recurring: input.recurring,
          cycleMonths: input.cycleMonths,
          startDate: input.startDate ?? null,
          effectiveFrom: input.effectiveFrom,
          targetCurrency: input.targetCurrency ?? null,
          budgetId: input.budgetId,
        },
        meta: { label: 'useUpdateGoal' },
      });
    },
  });
}

interface DeleteGoalInput {
  id: number;
  categoryId: number;
  budgetId: number;
  /** End the goal from this month (YYYY-MM) onwards; omitted = every month. */
  fromMonth?: string;
}

/** Removes the goal from `fromMonth` onwards (earlier months keep it), or from every month. */
export const useDeleteGoal = () => {
  const runtime = useRuntime();

  return useMutation({
    mutationFn: async (input: DeleteGoalInput) => {
      if (input.fromMonth) {
        await executeSpaceMutation<void>(runtime, {
          op: 'goals.endFrom',
          payload: {
            categoryId: input.categoryId,
            month: input.fromMonth,
            budgetId: input.budgetId,
          },
          meta: { label: 'useDeleteGoal' },
        });
        return;
      }
      await executeSpaceMutation<void>(runtime, {
        op: 'goals.delete',
        payload: {
          goalId: input.id,
          categoryId: input.categoryId,
          budgetId: input.budgetId,
        },
        meta: { label: 'useDeleteGoal' },
      });
    },
  });
};

export type SetGoalFromInput = {
  categoryId: number;
  fromMonth: string;
  toMonth: string | null;
  type: GoalType;
  purpose?: GoalPurpose;
  target: number;
  startDate: string;
  targetDate: string;
  recurring?: boolean;
  cycleMonths?: number | null;
  /** Currency of `target`; null/omitted = the budget currency. */
  targetCurrency?: string | null;
  budgetId: number;
};

/** The goal from `fromMonth` (to `toMonth`): a new timeframe, or replaces the one starting then. */
export function useSetGoalFrom() {
  const runtime = useRuntime();

  return useMutation<number, Error, SetGoalFromInput>({
    mutationFn: async (input) =>
      executeSpaceMutation<number>(runtime, {
        op: 'goals.setFrom',
        payload: {
          categoryId: input.categoryId,
          fromMonth: input.fromMonth,
          toMonth: input.toMonth,
          goalType: input.type,
          purpose: input.purpose || GoalPurpose.SPENDING,
          target: input.target,
          startDate: input.startDate,
          endDate: input.targetDate,
          recurring: input.recurring ?? false,
          cycleMonths: input.cycleMonths ?? null,
          targetCurrency: input.targetCurrency ?? null,
          budgetId: input.budgetId,
        },
        meta: { label: 'useSetGoalFrom' },
      }),
  });
}

export interface GoalTargetPreview {
  /** The target in the budget currency at today's rate. */
  converted: MilliUnits;
  source: GoalRateSource;
}

/**
 * The goal editor's "≈ in budget currency" line: `target` in `currency`
 * converted the way the saved goal will be (fetching today's rate first when
 * the cache has none). Null for the budget currency.
 */
export function useGoalTargetPreview(
  categoryId: number,
  budgetId: number,
  budgetCurrency: string | undefined,
  target: number,
  currency: string
) {
  const foreign = Boolean(budgetCurrency) && currency !== budgetCurrency;
  return useSpaceQuery<GoalTargetPreview | null>({
    key: ['goalTargetPreview', categoryId, currency, target],
    enabled: foreign && categoryId > 0,
    queryFn: async (services) => {
      const today = getTodayISO();
      await services.currency
        .getOrFetchRate(currency, budgetCurrency as string, today, budgetId)
        .catch(() => null);
      const [goal] = services.goals.withBudgetCurrencyTargets([
        {
          ID: 0,
          Type: GoalType.MONTHLY,
          Purpose: GoalPurpose.SPENDING,
          CategoryID: categoryId,
          Target: target as MilliUnits,
          StartDate: today,
          TargetCurrency: currency,
        },
      ]);
      return typeof goal?.TargetConverted === 'number'
        ? { converted: goal.TargetConverted, source: goal.TargetRateSource ?? 'missing' }
        : null;
    },
  });
}
