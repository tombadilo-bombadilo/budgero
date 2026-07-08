const DEFAULT_SPACE_KEY = 'budgero_default_space_v1';
const DEFAULT_BUDGET_KEY = 'budgero_default_budget_v1';

export function getStoredDefaultSpaceId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(DEFAULT_SPACE_KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setStoredDefaultSpaceId(spaceId: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!spaceId) {
      localStorage.removeItem(DEFAULT_SPACE_KEY);
    } else {
      localStorage.setItem(DEFAULT_SPACE_KEY, spaceId);
    }
  } catch {
    /* no-op: intentionally ignored */
  }
}

export function getStoredDefaultBudgetId(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(DEFAULT_BUDGET_KEY);
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setStoredDefaultBudgetId(budgetId: number | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (budgetId == null) {
      localStorage.removeItem(DEFAULT_BUDGET_KEY);
    } else {
      localStorage.setItem(DEFAULT_BUDGET_KEY, String(budgetId));
    }
  } catch {
    /* no-op: intentionally ignored */
  }
}

export function clearStoredDefaultBudgetId(): void {
  setStoredDefaultBudgetId(null);
}
