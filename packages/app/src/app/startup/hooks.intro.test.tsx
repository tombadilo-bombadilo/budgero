import React from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@shared/model/auth';
import { useAuthStartupSnapshot, useIntroStartupSnapshot } from './hooks';

const env = vi.hoisted(() => ({
  hasLocalPassword: false,
  profileQuery: {
    data: undefined as unknown,
    error: null as unknown,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@shared/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/lib/env')>()),
  IS_SELF_HOSTABLE_BUILD: true,
}));
vi.mock('@shared/lib/crypto', () => ({
  MasterPasswordManager: { hasPassword: () => env.hasLocalPassword },
}));
vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => env.profileQuery,
  useOptionalClerkAuth: () => null,
}));
vi.mock('@shared/model/useSelfHostAuth', () => ({
  useSelfHostAuth: (select: (s: unknown) => unknown) =>
    select({ token: 'token', clearSession: vi.fn() }),
}));
vi.mock('@shared/runtime/connectivity-service', () => ({
  getConnectivityService: () => ({
    getState: () => ({ lastChecked: 1, apiReachable: true, overall: true }),
    addListener: () => () => undefined,
  }),
}));

const user = (patch: Partial<User>) => ({ id: 'user-1', email: 'u@example.com', ...patch }) as User;

beforeEach(() => {
  localStorage.clear();
  env.hasLocalPassword = false;
  env.profileQuery = { data: undefined, error: null, isLoading: false, isError: false };
});

describe('onboarding (intro) gate', () => {
  it('opens for a new account the server says is not set up', () => {
    const { result } = renderHook(() =>
      useIntroStartupSnapshot(
        true,
        user({ is_master_password_set: false, onboarding_status: 'pending' })
      )
    );
    expect(result.current.status).toBe('intro_required');
  });

  it('never opens for an account with a master password, on a new device', () => {
    const { result } = renderHook(() =>
      useIntroStartupSnapshot(true, user({ is_master_password_set: true }))
    );
    expect(result.current.status).toBe('ready');
  });

  it('never opens for an account that completed onboarding', () => {
    const { result } = renderHook(() =>
      useIntroStartupSnapshot(
        true,
        user({ is_master_password_set: false, onboarding_status: 'completed' })
      )
    );
    expect(result.current.status).toBe('ready');
  });

  it('does not open without a profile (offline, or not loaded yet)', () => {
    const { result } = renderHook(() => useIntroStartupSnapshot(true, undefined));
    expect(result.current.status).toBe('ready');
  });
});

describe('auth snapshot (self-host)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );

  it('stays loading while the profile query has not started (reload before unlock)', () => {
    // useProfile waits for the first connectivity probe: idle, no data, no error.
    const { result } = renderHook(() => useAuthStartupSnapshot(), { wrapper });
    expect(result.current.status).toBe('loading');
  });

  it('is ready once the profile is there', () => {
    env.profileQuery = {
      data: user({ is_master_password_set: true, subscription_status: 'active' }),
      error: null,
      isLoading: false,
      isError: false,
    };
    const { result } = renderHook(() => useAuthStartupSnapshot(), { wrapper });
    expect(result.current.status).not.toBe('loading');
    expect(result.current.user?.id).toBe('user-1');
  });
});
