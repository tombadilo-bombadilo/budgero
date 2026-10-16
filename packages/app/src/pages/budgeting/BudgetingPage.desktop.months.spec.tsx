/**
 * The desktop budget page computes only the months it shows: the selected
 * month normally, and the multi-month drawer's months only while it is open
 * (and only as many as its "Show" count).
 */
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BudgetingPageDesktop } from './BudgetingPage.desktop';

const mocks = vi.hoisted(() => ({ monthlyBudget: vi.fn() }));

vi.mock('@entities/budget/api/useMonthlyBudget', () => ({
  useMonthlyBudget: (month: string, budgetId: number, enabled = true) => {
    mocks.monthlyBudget(month, budgetId, enabled);
    return { data: enabled ? [] : undefined };
  },
  useReadyToAssign: () => ({ data: 0 }),
}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      selectedBudget: { ID: 3, DisplayCurrency: 'USD' },
      globalLocalizer: new Intl.NumberFormat('en-US'),
      currentMonth: '2026-10',
      setCurrentMonth: () => {},
      selectedCategories: [],
      desktopBudgetLayout: 'table',
      showHiddenCategories: false,
      setShowHiddenCategories: () => {},
    }),
}));
vi.mock('@features/budget-planning/ui/BudgetTable', () => ({
  BudgetTable: ({ renderToolbar }: { renderToolbar?: (controls: unknown) => ReactNode }) => (
    <div>{renderToolbar?.({})}</div>
  ),
}));
vi.mock('@features/budgeting/ui/BudgetToolbar', () => ({
  BudgetToolbar: ({ extraContent }: { extraContent: ReactNode }) => <div>{extraContent}</div>,
}));
vi.mock('@features/budgeting/ui/BudgetContextPanel', () => ({ BudgetContextPanel: () => null }));
vi.mock('@features/budgeting/ui/ReadyToAssignHelpPopover', () => ({
  ReadyToAssignHelpPopover: () => null,
}));
vi.mock('@features/budget-planning/ui/PlanningNumberAnimation', () => ({
  PlanningAnimatedNumber: () => null,
}));
vi.mock('@entities/goal/api/useGoals', () => ({ useGoals: () => ({ data: [] }) }));
vi.mock('@features/budget-planning/lib/budget-transforms', () => ({
  transformBudgetRows: () => [],
}));
vi.mock('@features/category-management/api/useHideCategory', () => ({
  useHideCategory: () => ({ hideCategory: () => {}, hasHiddenCategories: false }),
}));
vi.mock('@shared/lib/privacy/useMaskedLocalizer', () => ({
  useFormatMaskedAmount: () => (value: number) => String(value),
}));
vi.mock('@shared/ui/MonthPickerPopover', () => ({ default: () => null }));
vi.mock('@shared/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@shared/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@shared/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select aria-label="month count" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock('@shared/hooks/useFocusCategoryFromNavState', () => ({
  useFocusCategoryFromNavState: () => null,
}));
vi.mock('@shared/hooks/useClearCategorySelectionOnMount', () => ({
  useClearCategorySelectionOnMount: () => {},
}));
vi.mock('@shared/hooks/useNavigateMonth', () => ({ useNavigateMonth: () => () => {} }));

afterEach(() => {
  cleanup();
  mocks.monthlyBudget.mockReset();
});

/** Months whose query is enabled on the latest render. */
function enabledMonths() {
  const calls = mocks.monthlyBudget.mock.calls;
  const lastRender = calls.slice(-7); // main query + the six drawer slots
  return [...new Set(lastRender.filter(([, , enabled]) => enabled).map(([month]) => month))];
}

describe('desktop budget page months', () => {
  it('computes only the selected month while the multi-month view is closed', () => {
    render(<BudgetingPageDesktop />);
    expect(enabledMonths()).toEqual(['2026-10']);
  });

  it('computes the shown months while the multi-month view is open', () => {
    render(<BudgetingPageDesktop />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Multi-Month/ }));
    });
    // Default "Show: 3".
    expect(enabledMonths()).toEqual(['2026-10', '2026-11', '2026-12']);

    act(() => {
      fireEvent.change(screen.getByLabelText('month count'), { target: { value: '6' } });
    });
    expect(enabledMonths()).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);

    act(() => {
      fireEvent.change(screen.getByLabelText('month count'), { target: { value: '2' } });
    });
    expect(enabledMonths()).toEqual(['2026-10', '2026-11']);
  });
});
