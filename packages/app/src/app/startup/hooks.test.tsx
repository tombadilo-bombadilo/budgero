import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@shared/model/auth';
import { useMasterPasswordStartupSnapshot } from './hooks';

let connectivityState = {
  clerkToken: false,
  apiReachable: true,
  wsConnected: false,
  overall: false,
  lastChecked: 1,
  selfHostable: true,
};

const runtimeMock = {};

const masterPasswordManagerMock = vi.hoisted(() => ({
  get: vi.fn(),
  hasPassword: vi.fn(),
  clearSessionOnly: vi.fn(),
  canVerifyLocally: vi.fn(() => false),
  verify: vi.fn(),
  store: vi.fn(),
}));

vi.mock('@shared/hooks/useConnectivity', () => ({
  useConnectivity: () => connectivityState,
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtimeMock,
  useActiveSpace: () => null,
  useActiveSpaceId: () => null,
  useAvailableSpaces: () => [],
}));

vi.mock('@shared/lib/crypto', () => ({
  MasterPasswordManager: masterPasswordManagerMock,
}));

vi.mock('@/app/service-guard/service-guard.utils', () => ({
  handleAccountReset: vi.fn(),
}));

vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: () => null,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useMasterPasswordStartupSnapshot', () => {
  beforeEach(() => {
    connectivityState = {
      clerkToken: false,
      apiReachable: true,
      wsConnected: false,
      overall: false,
      lastChecked: 1,
      selfHostable: true,
    };
    masterPasswordManagerMock.get.mockReset();
    masterPasswordManagerMock.hasPassword.mockReset();
    masterPasswordManagerMock.clearSessionOnly.mockReset();
    masterPasswordManagerMock.verify.mockReset();
    masterPasswordManagerMock.store.mockReset();
    masterPasswordManagerMock.hasPassword.mockReturnValue(false);
  });

  it('does not stay stuck in loading when connectivity updates during password lookup', async () => {
    let resolveGet: ((value: string | null) => void) | null = null;
    masterPasswordManagerMock.get.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveGet = resolve;
        })
    );

    const wrapper = createWrapper();
    const profile = { id: 'user-1', is_master_password_set: true } as unknown as User;

    const { result, rerender } = renderHook(
      ({ enabled, nextProfile }: { enabled: boolean; nextProfile: User | undefined }) =>
        useMasterPasswordStartupSnapshot(enabled, nextProfile),
      {
        initialProps: {
          enabled: true,
          nextProfile: profile,
        },
        wrapper,
      }
    );

    expect(result.current.status).toBe('loading');

    connectivityState = {
      ...connectivityState,
      lastChecked: 2,
    };
    rerender({
      enabled: true,
      nextProfile: profile,
    });

    await act(async () => {
      resolveGet?.(null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('required');
    });
  });
});
