/**
 * The category picker loads Available and Ready to Assign only while its list
 * is open (the register no longer computes the month's budget for every
 * mounted row), and shows the loaded figures once open.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SearchableCategorySelect } from './SearchableCategorySelect';

const mocks = vi.hoisted(() => ({
  monthlyBudget: vi.fn(),
  readyToAssign: vi.fn(),
}));

vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-a' }));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      selectedBudget: { ID: 4, DisplayCurrency: 'USD' },
      globalLocalizer: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }),
    }),
}));
vi.mock('@shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@entities/category/api/useCategories', () => ({
  useCategories: () => ({
    data: [
      { ID: 1, Name: 'Groceries', CategoryGroupID: 10 },
      { ID: 2, Name: 'Rent', CategoryGroupID: 10 },
    ],
    isLoading: false,
  }),
  useCategoryGroups: () => ({ data: [{ ID: 10, Name: 'Everyday' }], isLoading: false }),
  useAddCategory: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@entities/budget/api/useMonthlyBudget', () => ({
  useMonthlyBudget: (month: string, budgetId: number, enabled: boolean) => {
    mocks.monthlyBudget(month, budgetId, enabled);
    return {
      data: enabled
        ? [
            { CategoryID: 1, Available: 12_340 },
            { CategoryID: 2, Available: -5_000 },
          ]
        : undefined,
    };
  },
  useReadyToAssign: (budgetId: number, month: string | undefined, enabled: boolean) => {
    mocks.readyToAssign(budgetId, month, enabled);
    return { data: enabled ? 77_000 : undefined };
  },
}));
vi.mock('@features/category-management/ui/CreateCategoryDialog', () => ({
  CreateCategoryDialog: () => null,
}));

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverMock,
  });
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  mocks.monthlyBudget.mockReset();
  mocks.readyToAssign.mockReset();
});

const lastEnabled = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[2];

describe('SearchableCategorySelect budget figures', () => {
  it('does not load the budget while closed, then loads and shows it when opened', () => {
    render(
      <SearchableCategorySelect
        budgetId={4}
        selectedCategoryId={1}
        onCategorySelect={() => {}}
        includeReadyToAssign
      />
    );
    expect(lastEnabled(mocks.monthlyBudget)).toBe(false);
    expect(lastEnabled(mocks.readyToAssign)).toBe(false);

    fireEvent.click(screen.getByRole('combobox'));

    expect(lastEnabled(mocks.monthlyBudget)).toBe(true);
    expect(lastEnabled(mocks.readyToAssign)).toBe(true);
    expect(screen.getByText('12.34')).toBeTruthy();
    expect(screen.getByText('-5.00')).toBeTruthy();
    expect(screen.getByText('77.00')).toBeTruthy();
  });

  it('opens straight away (and loads) when mounted open, e.g. a register cell being edited', () => {
    render(
      <SearchableCategorySelect
        budgetId={4}
        selectedCategoryId={1}
        onCategorySelect={() => {}}
        defaultOpen
      />
    );
    expect(lastEnabled(mocks.monthlyBudget)).toBe(true);
    expect(screen.getByText('12.34')).toBeTruthy();
  });

  it('never loads its own copy when the caller provides the figures', () => {
    render(
      <SearchableCategorySelect
        budgetId={4}
        selectedCategoryId={1}
        onCategorySelect={() => {}}
        monthlyRows={[]}
        readyToAssignAmount={0}
        defaultOpen
      />
    );
    expect(lastEnabled(mocks.monthlyBudget)).toBe(false);
    expect(lastEnabled(mocks.readyToAssign)).toBe(false);
  });
});
