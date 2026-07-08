import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { transformBudgetRows } from '@features/budget-planning/lib/budget-transforms';
import { GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import { GoalCalculations, type CategoryFinancials } from '@budgero/core/browser';
import { useCycleFinancialsForGoals } from '@entities/goal/api/useGoals';
import { FilterType } from '@features/budget-planning/ui/SearchAndFilterControls';
import { HIDDEN_CATEGORIES_GROUP_NAME } from '@features/category-management/api/useHideCategory';

interface UseBudgetTableStateProps {
  rawRows: GetMonthlyBudgetRow[];
  goals: Goal[];
  currentMonth: string;
  currencyCode: string;
  sharedCollapsedGroups?: Set<string>;
  onSharedCollapsedGroupsChange?: (groups: Set<string>) => void;
  sharedExpandedCategories?: Set<string>;
  onSharedExpandedCategoriesChange?: (categories: Set<string>) => void;
  globalCollapsed?: boolean;
  externalSearchTerm?: string;
  focusCategoryId?: number | null;
  setFocusCategoryId?: (id: number | null) => void;
  budgetId?: number;
  showHiddenCategories?: boolean;
}

export function useBudgetTableState({
  rawRows,
  goals,
  currentMonth,
  currencyCode,
  sharedCollapsedGroups,
  onSharedCollapsedGroupsChange,
  sharedExpandedCategories,
  onSharedExpandedCategoriesChange,
  globalCollapsed,
  externalSearchTerm,
  focusCategoryId,
  setFocusCategoryId,
  budgetId,
  showHiddenCategories = false,
}: UseBudgetTableStateProps) {
  const [internalCollapsedGroups, setInternalCollapsedGroups] = useState<Set<string>>(new Set());
  const [internalExpandedCategories, setInternalExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [internalSearchTerm, setInternalSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [highlightedCategoryId, setHighlightedCategoryId] = useState<number | null>(null);

  const collapsedGroups = useMemo(() => {
    if (sharedCollapsedGroups !== undefined) {
      return sharedCollapsedGroups;
    }
    if (globalCollapsed !== undefined) {
      const allGroupIds = new Set(
        transformBudgetRows(rawRows, goals || [], currentMonth)
          .filter((row) => row.isGroup)
          .map((row) => row.id)
      );
      return globalCollapsed ? allGroupIds : new Set<string>();
    }
    return internalCollapsedGroups;
  }, [
    globalCollapsed,
    rawRows,
    goals,
    currentMonth,
    internalCollapsedGroups,
    sharedCollapsedGroups,
  ]);

  const noopSetCollapsedGroups = useCallback(() => {
    /* noop when globally controlled */
  }, []);

  const setCollapsedGroups = useMemo(
    () =>
      sharedCollapsedGroups !== undefined && onSharedCollapsedGroupsChange
        ? onSharedCollapsedGroupsChange
        : globalCollapsed !== undefined
          ? noopSetCollapsedGroups
          : setInternalCollapsedGroups,
    [sharedCollapsedGroups, onSharedCollapsedGroupsChange, globalCollapsed, noopSetCollapsedGroups]
  );

  const expandedCategories =
    sharedExpandedCategories !== undefined ? sharedExpandedCategories : internalExpandedCategories;
  const setExpandedCategories =
    sharedExpandedCategories !== undefined && onSharedExpandedCategoriesChange
      ? onSharedExpandedCategoriesChange
      : setInternalExpandedCategories;

  const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;

  // Yearly/target-date goals need assignment history for cycle-aware status
  const { data: cycleFinancials } = useCycleFinancialsForGoals(goals, currentMonth);

  const transformedRows = useMemo(() => {
    return transformBudgetRows(rawRows, goals || [], currentMonth, cycleFinancials);
  }, [rawRows, goals, currentMonth, cycleFinancials]);

  const groupIds = useMemo(() => {
    return new Set(transformedRows.filter((row) => row.isGroup).map((row) => row.id));
  }, [transformedRows]);

  const storageKey = useMemo(() => {
    if (budgetId === undefined || Number.isNaN(budgetId)) return null;
    return `budget-table:collapsed-groups:${budgetId}`;
  }, [budgetId]);

  const hasHydratedCollapsedState = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hasHydratedCollapsedState.current) return;
    if (!storageKey) return;
    if (sharedCollapsedGroups !== undefined) return;
    if (globalCollapsed !== undefined) return;

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        hasHydratedCollapsedState.current = true;
        return;
      }

      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const next = new Set<string>();
        parsed.forEach((id) => {
          if (typeof id === 'string' && groupIds.has(id)) {
            next.add(id);
          }
        });
        setInternalCollapsedGroups(next);
      }
    } catch (error) {
      console.warn('[useBudgetTableState] Failed to restore collapsed groups from storage', error);
    } finally {
      hasHydratedCollapsedState.current = true;
    }
  }, [storageKey, sharedCollapsedGroups, globalCollapsed, groupIds]);

  useEffect(() => {
    if (sharedCollapsedGroups !== undefined) return;
    if (globalCollapsed !== undefined) return;
    if (!hasHydratedCollapsedState.current) return;
    if (!storageKey || typeof window === 'undefined') return;

    const values = Array.from(internalCollapsedGroups);
    if (values.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(values));
    }
  }, [internalCollapsedGroups, storageKey, sharedCollapsedGroups, globalCollapsed]);

  useEffect(() => {
    if (sharedCollapsedGroups !== undefined) return;
    if (globalCollapsed !== undefined) return;

    setInternalCollapsedGroups((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (groupIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupIds, sharedCollapsedGroups, globalCollapsed]);

  const data = useMemo(() => {
    let filtered = transformedRows;

    const matchesGoalFilter = (
      row: (typeof transformedRows)[number],
      kind: 'underfunded' | 'overfunded'
    ): boolean => {
      const goal = goals?.find((g) => g.CategoryID === row.categoryId);
      if (!goal || !goal.Target || goal.Target <= 0) return false;
      const cycle = cycleFinancials?.[goal.CategoryID];
      const finances: CategoryFinancials = {
        available: row.available || 0,
        assigned: row.assigned || 0,
        activity: row.activity || 0,
        currencyCode,
        historicalAssignments: cycle?.historicalAssignments,
        plannedAssignments: cycle?.plannedAssignments,
      };
      const progress = GoalCalculations.calculateProgress(goal, finances, currentMonth);
      if (kind === 'underfunded') return !progress.isFunded;
      // overfunded: the goal type's own overfunding measure, rounded back to
      // integer milliunits so float residuals from pace math (e.g. a
      // target ÷ 7 months) never count as an overage.
      return roundMilli(progress.overfundedAmount) > 0;
    };

    if (filterType !== 'all') {
      filtered = transformedRows.filter((row) => {
        if (row.isGroup) {
          const hasMatchingChildren = transformedRows.some((child) => {
            if (child.isGroup || child.parentId !== row.id) return false;

            if (filterType === 'overspent') {
              return child.available < 0;
            }
            if (filterType === 'underfunded') {
              return matchesGoalFilter(child, 'underfunded');
            }
            if (filterType === 'overfunded') {
              return matchesGoalFilter(child, 'overfunded');
            }
            return false;
          });
          return hasMatchingChildren;
        }
        if (filterType === 'overspent') {
          return row.available < 0;
        }
        if (filterType === 'underfunded') {
          return matchesGoalFilter(row, 'underfunded');
        }
        if (filterType === 'overfunded') {
          return matchesGoalFilter(row, 'overfunded');
        }

        return true;
      });
    }

    const searchFiltered = searchTerm.trim()
      ? filtered.filter((row) => {
          if (row.isGroup) {
            const hasMatchingChildren = filtered.some(
              (child) =>
                !child.isGroup &&
                child.parentId === row.id &&
                child.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
            return hasMatchingChildren;
          }
          return row.name.toLowerCase().includes(searchTerm.toLowerCase());
        })
      : filtered;

    const hiddenFiltered = showHiddenCategories
      ? searchFiltered
      : searchFiltered.filter((row) => {
          if (row.isGroup && row.name === HIDDEN_CATEGORIES_GROUP_NAME) {
            return false;
          }
          if (!row.isGroup) {
            const parentGroup = searchFiltered.find((r) => r.id === row.parentId);
            if (parentGroup?.name === HIDDEN_CATEGORIES_GROUP_NAME) {
              return false;
            }
          }
          return true;
        });

    // Calculate group totals (only for filtered items)
    const groupTotals = new Map<
      string,
      { assigned: MilliUnits; activity: MilliUnits; available: MilliUnits }
    >();

    hiddenFiltered.forEach((row) => {
      if (!row.isGroup && row.parentId) {
        const current = groupTotals.get(row.parentId) || {
          assigned: ZERO_MILLI,
          activity: ZERO_MILLI,
          available: ZERO_MILLI,
        };
        groupTotals.set(row.parentId, {
          // roundMilli (not asMilli) so a stray fractional value in stored data
          // degrades to a rounded total instead of crashing the whole table.
          assigned: roundMilli(current.assigned + row.assigned),
          activity: roundMilli(current.activity + row.activity),
          available: roundMilli(current.available + row.available),
        });
      }
    });

    return hiddenFiltered
      .map((row) => {
        if (row.isGroup && groupTotals.has(row.id)) {
          const totals = groupTotals.get(row.id);
          if (totals) {
            return { ...row, ...totals };
          }
        }
        return row;
      })
      .filter((row) => {
        if (row.isGroup) return true;
        if (row.parentId && collapsedGroups.has(row.parentId)) return false;
        return true;
      });
  }, [
    transformedRows,
    collapsedGroups,
    searchTerm,
    filterType,
    goals,
    currentMonth,
    currencyCode,
    cycleFinancials,
    showHiddenCategories,
  ]);

  // Handle category focus from external sources. This must run only ONCE per
  // focus request. Some focus sources (e.g. navigating in via location.state)
  // keep focusCategoryId set indefinitely, so without a guard this effect re-runs
  // on every collapsedGroups/expandedCategories change — re-expanding the focused
  // group and re-highlighting the category (which then gets auto-reselected),
  // making "collapse all" appear to fail and fighting the user's deselection.
  const handledFocusRef = useRef<number | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focusCategoryId) {
      handledFocusRef.current = null;
      return;
    }
    if (handledFocusRef.current === focusCategoryId) return;

    const target = transformedRows.find((r) => !r.isGroup && r.categoryId === focusCategoryId);
    if (!target) {
      // Clear stale focus if category not found in current view
      setFocusCategoryId?.(null);
      return;
    }
    handledFocusRef.current = focusCategoryId;

    if (target.parentId && collapsedGroups.has(target.parentId)) {
      const newCollapsed = new Set(collapsedGroups);
      newCollapsed.delete(target.parentId);
      setCollapsedGroups(newCollapsed);
    }
    if (!expandedCategories.has(target.id)) {
      const newExpanded = new Set(expandedCategories);
      newExpanded.add(target.id);
      setExpandedCategories(newExpanded);
    }

    // Scroll and highlight after DOM updates. Tracked in a ref rather than effect
    // cleanup so the re-renders triggered by the expand calls above don't cancel it.
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      const el = document.querySelector(
        `[data-category-id="${focusCategoryId}"]`
      ) as HTMLElement | null;
      if (el?.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setHighlightedCategoryId(focusCategoryId);
      setTimeout(() => setHighlightedCategoryId(null), 2000);
      // Clear the focus flag in the store (no-op for prop-driven focus).
      setFocusCategoryId?.(null);
    }, 50);
  }, [
    focusCategoryId,
    transformedRows,
    setFocusCategoryId,
    setHighlightedCategoryId,
    setExpandedCategories,
    collapsedGroups,
    setCollapsedGroups,
    expandedCategories,
  ]);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const toggleGroup = (groupId: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupId)) {
      newCollapsed.delete(groupId);
    } else {
      newCollapsed.add(groupId);
    }
    setCollapsedGroups(newCollapsed);
  };

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleAllGroups = () => {
    const allGroupIds = data.filter((row) => row.isGroup).map((row) => row.id);

    if (collapsedGroups.size === 0) {
      setCollapsedGroups(new Set(allGroupIds));
    } else {
      setCollapsedGroups(new Set());
    }
  };

  return {
    collapsedGroups,
    expandedCategories,
    searchTerm,
    filterType,
    highlightedCategoryId,

    setInternalSearchTerm,
    setFilterType,

    transformedRows,
    data,

    toggleGroup,
    toggleCategory,
    toggleAllGroups,
  };
}
