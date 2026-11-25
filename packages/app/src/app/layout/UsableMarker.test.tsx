import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAppUsable,
  resetStartupTimingForTests,
  takeUsableBucket,
} from '@shared/lib/analytics/startup-timing';
import { UsableMarker } from './UsableMarker';

function SlowPage({ resolve }: { resolve: (fn: () => void) => void }) {
  useQuery({
    queryKey: ['first-screen'],
    queryFn: () => new Promise<number>((done) => resolve(() => done(1))),
  });
  return null;
}

afterEach(() => {
  vi.useRealTimers();
  resetStartupTimingForTests();
});

describe('UsableMarker', () => {
  it("marks the app usable once the first page's queries have finished", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <SlowPage resolve={(fn) => (finish = fn)} />
        <UsableMarker />
      </QueryClientProvider>
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(isAppUsable()).toBe(false);

    finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(isAppUsable()).toBe(true);
    expect(takeUsableBucket()).toBe('<1s');
  });

  it('stops waiting on a query that never finishes', async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <SlowPage resolve={() => {}} />
        <UsableMarker />
      </QueryClientProvider>
    );
    await vi.advanceTimersByTimeAsync(29_000);
    expect(isAppUsable()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(isAppUsable()).toBe(true);
  });
});
