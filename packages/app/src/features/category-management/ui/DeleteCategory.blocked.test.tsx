import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CategoryRowHeader,
  DesktopCompactHeader,
} from '@features/budget-planning/ui/category-row/CategoryRowHeader';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import { asMilli } from '@shared/lib/currency/milli';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';

vi.mock('@entities/budget/api/useGoalFundingSettings', () => ({
  useGoalFundingSettings: () => ({
    CategoryPriorityMode: 'numeric',
    ShowCategoryPriorities: false,
    isReady: true,
  }),
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useUpdateFundingPriorities: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const row: BudgetRow = {
  id: 'c1',
  categoryId: 1,
  categoryGroupId: 1,
  name: 'Visa',
  assigned: asMilli(0),
  activity: asMilli(0),
  available: asMilli(0),
  isGroup: false,
};

describe('category delete UI', () => {
  it.each([CategoryRowHeader, DesktopCompactHeader])(
    'disables Delete with the reason for categories that cannot be deleted',
    async (Header) => {
      const onDelete = vi.fn();
      render(
        <Header
          item={{ ...row, deleteBlockedReason: 'It tracks payments for the Visa credit card.' }}
          budgetId={7}
          onEditCategory={vi.fn()}
          onDeleteCategory={onDelete}
        />
      );
      await userEvent.click(screen.getAllByRole('button')[0]);
      const button = screen.getByRole('button', { name: 'Delete' });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('It tracks payments for the Visa credit card.');
      await userEvent.click(button);
      expect(onDelete).not.toHaveBeenCalled();
    }
  );

  it('keeps Delete available otherwise', async () => {
    const onDelete = vi.fn();
    render(
      <CategoryRowHeader
        item={row}
        budgetId={7}
        onEditCategory={vi.fn()}
        onDeleteCategory={onDelete}
      />
    );
    await userEvent.click(screen.getAllByRole('button')[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(row);
  });

  it('the move dialog states every month of assignments, the goal and the schedule (A6)', () => {
    render(
      <DeleteCategoryDialog
        open
        onClose={vi.fn()}
        categories={[
          { categoryId: 1, name: 'Dining' },
          { categoryId: 2, name: 'Food' },
        ]}
        currentCategoryId={1}
        currentCategoryTotalTransactions={4}
        currentCategoryAssigned={asMilli(0)}
        impact={{
          categories: 1,
          transactions: 4,
          assignedMonths: 3,
          assignedTotal: 75_000,
          goals: 1,
          scheduled: 2,
          blocked: null,
        }}
        onDelete={vi.fn()}
        formatAmount={(value) => `$${value / 1000}`}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Assigned amounts in 3 months (total $75)');
    expect(dialog).toHaveTextContent('Scheduled transactions using this category (2)');
    expect(dialog).toHaveTextContent('Its goal is deleted with it');
    expect(dialog).toHaveTextContent('You can undo this.');
  });
});
