import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';

const order: string[] = [];
vi.mock('@shared/lib/local-copies', () => ({
  wipeLocalBudgetCopies: vi.fn(async () => {
    order.push('wipe');
    return true;
  }),
}));
vi.mock('@shared/api/api-client', () => ({
  authApi: { resetMasterPassword: vi.fn(async () => undefined) },
  pushApi: { clearQueue: vi.fn(async () => undefined), revokeToken: vi.fn(async () => undefined) },
}));

const { handleAccountReset } = await import('./service-guard.utils');

describe('handleAccountReset', () => {
  it('stops the runtime before wiping the local copies', async () => {
    vi.useFakeTimers();
    const runtime = { destroy: vi.fn(() => void order.push('destroy')) };
    const queryClient = {
      cancelQueries: vi.fn(async () => undefined),
      clear: vi.fn(),
    } as unknown as QueryClient;
    await handleAccountReset(runtime, queryClient);
    expect(order).toEqual(['destroy', 'wipe']);
    vi.useRealTimers();
  });
});
