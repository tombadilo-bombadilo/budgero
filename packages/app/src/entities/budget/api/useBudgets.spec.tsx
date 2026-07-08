import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { Budget } from '@budgero/core/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '@shared/store/useUiStore';
import {
  getStoredDefaultBudgetId,
  setStoredDefaultBudgetId,
} from '@shared/runtime/workspace-preferences';
import { useAddBudget, useDeleteBudget } from './useBudgets';

const mockExecute = vi.fn();
const mockGetAllBudgets = vi.fn();

const runtimeMock = {
  isInitialized: () => true,
  getActiveSpaceId: () => 'space-a',
  services: () => ({
    budgets: {
      getAllBudgets: mockGetAllBudgets,
    },
  }),
  mutationsRouter: () => ({
    execute: mockExecute,
  }),
};

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtimeMock,
  useActiveSpaceId: () => 'space-a',
}));

function createBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    ID: 1,
    SpaceID: 'space-a',
    Name: 'Main budget',
    DisplayCurrency: 'USD',
    BadgeIcon: 'Wallet',
    NumberFormat: '$1,096.56',
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('budget mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useUiStore.setState({ selectedBudget: null });
  });

  it('useAddBudget updates the active-space cache and selects the created budget immediately', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const createdBudget = createBudget({ ID: 16, Name: 'Created budget', BadgeIcon: 'Sparkles' });
    mockExecute.mockResolvedValue({ result: 16, synced: true, queued: false });
    mockGetAllBudgets.mockReturnValue([createdBudget]);

    const { result } = renderHook(() => useAddBudget(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Created budget',
        displayCurrency: 'USD',
        badgeIcon: 'Sparkles',
        number_format: '$1,096.56',
        create_default_categories: true,
      });
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-a',
        payload: expect.objectContaining({
          spaceId: 'space-a',
        }),
      })
    );
    expect(mockGetAllBudgets).toHaveBeenCalledWith('space-a');
    expect(queryClient.getQueryData(['budgets', 'space-a'])).toEqual([createdBudget]);
    expect(useUiStore.getState().selectedBudget).toEqual(createdBudget);
  });

  it('useDeleteBudget rotates selection to the next valid budget and clears an invalid stored default', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const deletedBudget = createBudget({ ID: 1, Name: 'Delete me' });
    const remainingBudget = createBudget({ ID: 2, Name: 'Keep me', BadgeIcon: 'Check' });
    useUiStore.setState({ selectedBudget: deletedBudget });
    setStoredDefaultBudgetId(1);
    mockExecute.mockResolvedValue(undefined);
    mockGetAllBudgets.mockReturnValue([remainingBudget]);

    const { result } = renderHook(() => useDeleteBudget(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(1);
    });

    expect(queryClient.getQueryData(['budgets', 'space-a'])).toEqual([remainingBudget]);
    expect(useUiStore.getState().selectedBudget).toEqual(remainingBudget);
    expect(getStoredDefaultBudgetId()).toBeNull();
  });

  it('useDeleteBudget clears selection when the active workspace becomes empty', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const deletedBudget = createBudget({ ID: 9, Name: 'Last budget' });
    useUiStore.setState({ selectedBudget: deletedBudget });
    setStoredDefaultBudgetId(9);
    mockExecute.mockResolvedValue(undefined);
    mockGetAllBudgets.mockReturnValue([]);

    const { result } = renderHook(() => useDeleteBudget(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(9);
    });

    expect(queryClient.getQueryData(['budgets', 'space-a'])).toEqual([]);
    expect(useUiStore.getState().selectedBudget).toBeNull();
    expect(getStoredDefaultBudgetId()).toBeNull();
  });
});
