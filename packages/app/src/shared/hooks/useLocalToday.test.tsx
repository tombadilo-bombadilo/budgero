import { act, renderHook } from '@testing-library/react';
import { useLocalToday } from './useLocalToday';

afterEach(() => vi.useRealTimers());

describe('useLocalToday', () => {
  it('turns over at local midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 0));
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe('2026-11-11');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    expect(result.current).toBe('2026-11-12');
  });
});
