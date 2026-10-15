import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useMarkRecurringOccurrenceNotified,
  useMarkRecurringOccurrenceReady,
  useSkipRecurringOccurrence,
} from './useRecurringTransactions';

const mockExecute = vi.fn();
const mockGetOccurrence = vi.fn();

const runtimeMock = {
  getActiveSpaceId: () => 'space-a',
  services: () => ({ recurring: { getOccurrenceWithTemplate: mockGetOccurrence } }),
  mutationsRouter: () => ({ execute: mockExecute }),
};

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtimeMock,
  useActiveSpaceId: () => 'space-a',
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('recurring occurrence mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ result: {}, synced: true, queued: false });
    mockGetOccurrence.mockReturnValue({ id: 12, recurringTransactionId: 3, dueDate: '2026-11-01' });
  });

  it('sends the stable template and due date alongside the local occurrence ID', async () => {
    const markReady = renderHook(() => useMarkRecurringOccurrenceReady(), { wrapper }).result;
    const skip = renderHook(() => useSkipRecurringOccurrence(), { wrapper }).result;
    const notified = renderHook(() => useMarkRecurringOccurrenceNotified(), { wrapper }).result;

    await act(async () => {
      await markReady.current.mutateAsync({ occurrenceId: 12, transactionDate: '2026-11-02' });
      await skip.current.mutateAsync({ id: 12 });
      await notified.current.mutateAsync({ id: 12 });
    });

    const payloads = mockExecute.mock.calls.map(([spec]) => [spec.op, spec.payload]);
    expect(payloads).toEqual([
      [
        'recurring.markReady',
        {
          options: {
            occurrenceId: 12,
            transactionDate: '2026-11-02',
            recurringTransactionId: 3,
            dueDate: '2026-11-01',
          },
        },
      ],
      ['recurring.skip', { id: 12, recurringTransactionId: 3, dueDate: '2026-11-01' }],
      ['recurring.markNotified', { id: 12, recurringTransactionId: 3, dueDate: '2026-11-01' }],
    ]);
  });

  it('falls back to the bare ID when the occurrence cannot be read', async () => {
    mockGetOccurrence.mockImplementation(() => {
      throw new Error('not found');
    });
    const skip = renderHook(() => useSkipRecurringOccurrence(), { wrapper }).result;

    await act(async () => {
      await skip.current.mutateAsync({ id: 12 });
    });

    expect(mockExecute.mock.calls[0][0].payload).toEqual({ id: 12 });
  });
});
