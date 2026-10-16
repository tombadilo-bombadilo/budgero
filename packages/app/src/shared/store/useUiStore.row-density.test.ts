import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const persistUserPreferencesPatch = vi.fn();
vi.mock('@shared/lib/user-preferences-sync', () => ({ persistUserPreferencesPatch }));

const KEY = 'budgero:budget-row-density';

async function loadStore() {
  vi.resetModules();
  return (await import('./useUiStore')).useUiStore;
}

describe('budget row density preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    persistUserPreferencesPatch.mockClear();
  });
  afterEach(() => window.localStorage.clear());

  it('defaults to comfortable', async () => {
    const store = await loadStore();
    expect(store.getState().budgetRowDensity).toBe('comfortable');
  });

  it('restores a stored compact density and ignores junk values', async () => {
    window.localStorage.setItem(KEY, 'compact');
    expect((await loadStore()).getState().budgetRowDensity).toBe('compact');

    window.localStorage.setItem(KEY, 'tiny');
    expect((await loadStore()).getState().budgetRowDensity).toBe('comfortable');
  });

  it('keeps the choice on this device only (no workspace or profile sync)', async () => {
    const store = await loadStore();
    store.getState().setBudgetRowDensity('compact');
    expect(store.getState().budgetRowDensity).toBe('compact');
    expect(window.localStorage.getItem(KEY)).toBe('compact');

    store.getState().setBudgetRowDensity('comfortable');
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(persistUserPreferencesPatch).not.toHaveBeenCalled();
  });
});
