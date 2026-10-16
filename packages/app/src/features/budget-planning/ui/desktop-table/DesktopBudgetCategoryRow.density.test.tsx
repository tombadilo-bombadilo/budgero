import React from 'react';
import { render, screen } from '@testing-library/react';
import { Table, TableBody } from '@shared/ui/table';
import { asMilli } from '@shared/lib/currency/milli';
import type { BudgetRow } from '../../lib/budget-transforms';
import { DesktopBudgetCategoryRow } from './DesktopBudgetCategoryRow';

vi.mock('@features/budget-planning/ui/AvailableInfoPopover', () => ({
  AvailableInfoPopover: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@entities/budget/api/useGoalFundingSettings', () => ({
  useGoalFundingSettings: () => ({
    CategoryPriorityMode: 'five-levels',
    ShowCategoryPriorities: true,
    isReady: true,
  }),
}));

const row: BudgetRow = {
  id: 'c1',
  name: 'Groceries',
  assigned: asMilli(100_000),
  activity: asMilli(0),
  available: asMilli(100_000),
  totalTransactions: 0,
  isGroup: false,
  categoryId: 1,
  categoryGroupId: 1,
  parentId: 'g1',
};

function renderRow(compact?: boolean) {
  render(
    <Table>
      <TableBody>
        <DesktopBudgetCategoryRow
          row={row}
          globalLocalizer={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })}
          currentMonth="2026-08"
          selectedBudgetId={1}
          onEditCategory={() => {}}
          onDeleteCategory={() => {}}
          onUpdateAssignment={async () => {}}
          onActivityClick={() => {}}
          isSelected={false}
          selectable
          compact={compact}
        />
      </TableBody>
    </Table>
  );
  return screen.getByTestId('budget-row-groceries');
}

describe('DesktopBudgetCategoryRow density', () => {
  it('keeps the comfortable row by default', () => {
    const tr = renderRow();
    expect(tr.className).not.toContain('[&>td]:py-0.5');
    expect(screen.getByTestId('activity-groceries').className).toContain('min-h-[28px]');
  });

  it('tightens cell padding and control heights when compact', () => {
    const tr = renderRow(true);
    expect(tr.className).toContain('[&>td]:py-0.5');
    expect(screen.getByTestId('activity-groceries').className).toContain('min-h-6');
    expect(screen.getByTestId('activity-groceries').className).not.toContain('min-h-[28px]');
    // Same information: every column still renders.
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(tr.querySelectorAll('td')).toHaveLength(5);
  });
});
