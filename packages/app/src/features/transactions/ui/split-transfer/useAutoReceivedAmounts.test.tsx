import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoReceivedAmounts } from './useAutoReceivedAmounts';

const rates = vi.hoisted(() => ({ value: 0.9 as number | null }));
vi.mock('@entities/currency/lib/currency-utils', () => ({
  // No rate is known for 11 March.
  getExchangeRate: vi.fn(async (from: string, to: string, date: string) =>
    from === 'USD' && to === 'EUR' && date !== '2026-03-11' ? rates.value : null
  ),
}));

interface Line {
  target: number | null;
  amount: number;
  received?: number | null;
  auto?: boolean;
}

const accounts = [
  { ID: 2, Name: 'Savings', Currency: 'USD', OnBudget: true },
  { ID: 3, Name: 'Euro', Currency: 'EUR', OnBudget: true },
];

/** A split editor's state driven by the hook, like the real editors keep it. */
function useEditor(initial: Line[], date = '2026-03-10') {
  const [lines, setLines] = React.useState(initial);
  useAutoReceivedAmounts({
    lines,
    access: {
      target: (line) => line.target,
      amount: (line) => line.amount,
      received: (line) => line.received,
      auto: (line) => line.auto !== false,
    },
    onEstimates: (estimates) =>
      setLines((previous) =>
        previous.map((line, index) =>
          estimates.has(index) ? { ...line, received: estimates.get(index) } : line
        )
      ),
    accounts,
    parentCurrency: 'USD',
    amountCurrency: 'USD',
    date,
    budgetId: 1,
  });
  return { lines, setLines };
}

describe('useAutoReceivedAmounts', () => {
  beforeEach(() => {
    rates.value = 0.9;
  });

  it('fills the estimate and follows the line amount, but never overrides a typed amount', async () => {
    const { result } = renderHook(() =>
      useEditor([
        { target: 3, amount: 100_000 },
        { target: 3, amount: 100_000, received: 88_000, auto: false },
        { target: 2, amount: 100_000 },
      ])
    );
    await waitFor(() => expect(result.current.lines[0].received).toBe(90_000));
    expect(result.current.lines[1].received).toBe(88_000);
    expect(result.current.lines[2].received).toBeUndefined();
    act(() =>
      result.current.setLines((lines) => lines.map((line) => ({ ...line, amount: 200_000 })))
    );
    await waitFor(() => expect(result.current.lines[0].received).toBe(180_000));
    expect(result.current.lines[1].received).toBe(88_000);
  });

  it('fills the same estimate again after a retarget and back, or a removed and re-added line', async () => {
    const { result } = renderHook(() => useEditor([{ target: 3, amount: 100_000 }]));
    await waitFor(() => expect(result.current.lines[0].received).toBe(90_000));
    // Retarget away (the editors clear the amount) and back.
    act(() => result.current.setLines([{ target: 2, amount: 100_000, received: null }]));
    act(() => result.current.setLines([{ target: 3, amount: 100_000, received: null }]));
    await waitFor(() => expect(result.current.lines[0].received).toBe(90_000));
    // Removed, then a new line ("Save and add another").
    act(() => result.current.setLines([]));
    act(() => result.current.setLines([{ target: 3, amount: 100_000 }]));
    await waitFor(() => expect(result.current.lines[0].received).toBe(90_000));
  });

  it('clears a stale auto-filled amount when no rate resolves for the new inputs', async () => {
    const { result, rerender } = renderHook(
      ({ date }) => useEditor([{ target: 3, amount: 100_000 }], date),
      {
        initialProps: { date: '2026-03-10' },
      }
    );
    await waitFor(() => expect(result.current.lines[0].received).toBe(90_000));
    rerender({ date: '2026-03-11' });
    await waitFor(() => expect(result.current.lines[0].received).toBeNull());
  });
});
