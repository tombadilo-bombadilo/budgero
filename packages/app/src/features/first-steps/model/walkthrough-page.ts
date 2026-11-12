import { useMemo } from 'react';
import type { GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import type { PickedCategory } from './goal-walkthrough';

/** The fund step's "Show me": the category's row and its Assigned field. */
export function pointAtAssigned(categoryId: number): void {
  const ui = useUiStore.getState();
  ui.setHighlightAssignmentCategoryId(categoryId);
  ui.setFocusCategoryId(categoryId);
}

/** The one category selected on the page (the last one picked), with whether it has a goal. */
export function useSelectedForWalkthrough(
  rows: GetMonthlyBudgetRow[],
  goals: Goal[]
): PickedCategory | null {
  const selected = useUiStore((state) => state.selectedCategories);
  const last = selected.at(-1);
  const id = last?.ID ?? null;
  const name = (id && rows.find((row) => row.CategoryID === id)?.Category) || last?.Name || '';
  const hasGoal = id !== null && goals.some((goal) => goal.CategoryID === id);
  return useMemo(() => (id === null ? null : { id, name, hasGoal }), [id, name, hasGoal]);
}
