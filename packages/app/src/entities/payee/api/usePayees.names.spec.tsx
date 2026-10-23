/**
 * Payee pickers read names only (no usage GROUP BY over every row) and keep
 * the same trimmed, de-duplicated, sorted list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { usePayees } from './usePayees';

const mocks = vi.hoisted(() => ({ names: vi.fn(), usage: vi.fn() }));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useActiveSpaceId: () => 'space-1',
  useRuntime: () => ({
    services: () => ({
      payees: { getPayeeNames: mocks.names, getPayeesWithUsage: mocks.usage },
    }),
  }),
}));

describe('usePayees', () => {
  it('lists names from the names-only query', async () => {
    mocks.names.mockReturnValue(['zoo', ' Bakery ', 'Amazon', 'Bakery']);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePayees(3), {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.data).toEqual(['Amazon', 'Bakery', 'zoo']));
    expect(mocks.names).toHaveBeenCalledWith(3);
    expect(mocks.usage).not.toHaveBeenCalled();
  });
});
