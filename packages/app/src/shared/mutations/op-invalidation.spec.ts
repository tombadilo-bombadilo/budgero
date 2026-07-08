/**
 * Proves the executor-side invalidation chain end-to-end: a local
 * budgets.updateName must invalidate (and refetch) the space-scoped
 * ['budgets', spaceKey] query that useBudgets subscribes to.
 */
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { MutationExecutor, type QueryClientLike } from '@budgero/runtime';
import { getInvalidatesForOp } from '@shared/mutations/op-code-registry';

describe('op registry invalidation through MutationExecutor', () => {
  it('budgets.updateName invalidates and refetches the space-scoped budgets query', async () => {
    const spaceId = 'space-1';
    const qc = new QueryClient();

    let name = 'old';
    const queryFn = vi.fn(async () => [{ ID: 1, Name: name }]);
    // Mirror useBudgets: ['budgets', spaceKey] with a long staleTime.
    await qc.prefetchQuery({ queryKey: ['budgets', spaceId], queryFn, staleTime: 60_000 });
    const observed = qc.getQueryData<{ ID: number; Name: string }[]>(['budgets', spaceId]);
    expect(observed?.[0]?.Name).toBe('old');

    const executor = new MutationExecutor({
      executeOp: async () => {
        name = 'new';
        return undefined;
      },
      getUndoSpec: () => undefined,
      getInvalidatesForOp,
      // Real QueryClient is a superset of the runtime's minimal interface; the
      // predicate param types are contravariant-incompatible, so cast here.
      getQueryClient: () => qc as unknown as QueryClientLike,
      pushUndo: () => {},
      recordHistory: () => {},
      getActiveSpaceId: () => spaceId,
      getSpaceRole: () => 'owner',
    });

    await executor.execute({
      op: 'budgets.updateName',
      payload: { id: 1, name: 'new' },
      spaceId,
    });

    const state = qc.getQueryState(['budgets', spaceId]);
    expect(state?.isInvalidated).toBe(true);

    // An active observer would refetch automatically; simulate the refetch an
    // invalidated query performs and confirm fresh data lands.
    await qc.refetchQueries({ queryKey: ['budgets'] });
    const updated = qc.getQueryData<{ ID: number; Name: string }[]>(['budgets', spaceId]);
    expect(updated?.[0]?.Name).toBe('new');
  });
});
