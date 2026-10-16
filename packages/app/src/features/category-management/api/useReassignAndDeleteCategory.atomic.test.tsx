import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { useReassignAndDeleteCategory } from './useReassignAndDeleteCategory';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useDeleteCategory: () => ({ mutateAsync: mocks.legacy }),
}));
vi.mock('@entities/budget/api/useMonthlyBudget', () => ({
  useReassignAssignments: () => ({ mutateAsync: mocks.legacy }),
}));
vi.mock('@entities/transaction/api/useTransactions', () => ({
  useReassignTransactions: () => ({ mutateAsync: mocks.legacy }),
}));
vi.mock('@shared/runtime/mutation-router', () => ({
  executeSpaceMutation: (_runtime: unknown, spec: unknown) => mocks.execute(spec),
}));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({
    getActiveSpaceId: () => 'space-a',
    services: () => ({
      categories: {
        getCategory: (id: number) => ({ ID: id, Name: 'Custom', BudgetID: 7, CategoryGroupID: 10 }),
        getCategoryGroup: () => ({ Name: 'Spending' }),
        deleteCategoryWithUndo: () => null,
      },
    }),
  }),
}));

describe('delete category and move its data (A8)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.execute.mockResolvedValue(null);
  });

  it('runs as one atomic op instead of three separately synced ones', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useReassignAndDeleteCategory(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(() =>
      result.current.mutateAsync({ budgetId: 7, oldCategoryId: 2, newCategoryId: 3 })
    );
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'categories.deleteAndReassign',
        payload: { id: 2, budgetId: 7, reassignTo: 3 },
      })
    );
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
