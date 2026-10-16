/**
 * Ready to Assign: the number and the breakdown popover share one cache entry
 * per budget and month (one core computation), callers that omit the month
 * share the current month's entry, and writes still refresh both.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import type { ReadyToAssignBreakdown } from '@budgero/core/browser';
import { getTodayISO } from '@shared/lib/date-utils';
import {
  useBatchUpsertAssignments,
  useReadyToAssign,
  useReadyToAssignBreakdown,
} from './useMonthlyBudget';

const mocks = vi.hoisted(() => ({
  breakdown: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useActiveSpaceId: () => 'space-1',
  useRuntime: () => ({
    getActiveSpaceId: () => 'space-1',
    services: () => ({
      monthlyBudgets: {
        getReadyToAssignBreakdown: mocks.breakdown,
        getReadyToAssign: () => {
          throw new Error('the number is selected from the breakdown');
        },
      },
    }),
    mutationsRouter: () => ({ execute: mocks.execute }),
  }),
}));

const breakdown = (readyToAssign: number, month: string): ReadyToAssignBreakdown =>
  ({
    mode: 'cumulative',
    month,
    income: 500_000,
    assignments: 500_000 - readyToAssign,
    futureAssignments: 0,
    offBudgetTransfers: 0,
    inBudgetTransfers: 0,
    revaluations: 0,
    priorCashOverspend: 0,
    readyToAssign,
  }) as ReadyToAssignBreakdown;

function setup<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = renderHook(hook, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, ...view };
}

describe('Ready to Assign queries', () => {
  const current = getTodayISO().slice(0, 7);
  let value = 120_000;

  beforeEach(() => {
    vi.resetAllMocks();
    value = 120_000;
    mocks.breakdown.mockImplementation((_budgetId: number, month: string) =>
      breakdown(value, month)
    );
    mocks.execute.mockResolvedValue({ result: undefined });
  });

  it('computes RTA once for the number and the popover breakdown', async () => {
    const { result } = setup(() => ({
      number: useReadyToAssign(1, '2026-09'),
      popover: useReadyToAssignBreakdown(1, '2026-09'),
    }));
    await waitFor(() => expect(result.current.number.data).toBe(120_000));
    expect(result.current.popover.data?.readyToAssign).toBe(120_000);
    expect(mocks.breakdown).toHaveBeenCalledTimes(1);
    expect(mocks.breakdown).toHaveBeenCalledWith(1, '2026-09');
  });

  it("shares the current month's entry with callers that omit the month", async () => {
    const { result } = setup(() => ({
      picker: useReadyToAssign(1),
      page: useReadyToAssign(1, current),
      popover: useReadyToAssignBreakdown(1),
    }));
    await waitFor(() => expect(result.current.picker.data).toBe(120_000));
    expect(result.current.page.data).toBe(120_000);
    expect(mocks.breakdown).toHaveBeenCalledTimes(1);
    expect(mocks.breakdown).toHaveBeenCalledWith(1, current);
  });

  it('a write that invalidates readyToAssign refreshes the number and the breakdown', async () => {
    const { result, client } = setup(() => ({
      number: useReadyToAssign(1, '2026-09'),
      popover: useReadyToAssignBreakdown(1, '2026-09'),
    }));
    await waitFor(() => expect(result.current.number.data).toBe(120_000));
    value = 90_000;
    // Registry keys ['readyToAssign'] / ['readyToAssign', '*'] invalidate the whole root.
    await act(() =>
      client.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'readyToAssign' })
    );
    await waitFor(() => expect(result.current.number.data).toBe(90_000));
    expect(result.current.popover.data?.readyToAssign).toBe(90_000);
    expect(mocks.breakdown).toHaveBeenCalledTimes(2);
  });

  it('batch assignment patches the shared entry optimistically and then refetches', async () => {
    let release: () => void = () => {};
    mocks.execute.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ result: undefined })))
    );
    const { result, client } = setup(() => ({
      number: useReadyToAssign(1, '2026-09'),
      popover: useReadyToAssignBreakdown(1, '2026-09'),
      batch: useBatchUpsertAssignments(),
    }));
    await waitFor(() => expect(result.current.number.data).toBe(120_000));
    client.setQueryData(
      ['monthlyBudget', 'space-1', '2026-09', 1],
      [{ CategoryID: 5, Assigned: 10_000, Available: 10_000 }]
    );

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.batch.mutateAsync([
        { categoryId: 5, amount: 30_000, month: '2026-09', budgetId: 1 },
      ]);
    });
    await waitFor(() => expect(result.current.number.data).toBe(100_000));
    expect(result.current.popover.data?.assignments).toBe(400_000);

    value = 100_000;
    await act(async () => {
      release();
      await pending;
    });
    await waitFor(() => expect(mocks.breakdown).toHaveBeenCalledTimes(2));
    expect(result.current.number.data).toBe(100_000);
  });
});
