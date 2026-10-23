import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackSubscriptionCanceled = vi.fn();
const cancel = vi.fn(async () => undefined);

vi.mock('@shared/lib/analytics/analytics', () => ({ trackSubscriptionCanceled }));
vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => ({ data: { subscription_id: null }, isLoading: false }),
}));
vi.mock('@shared/hooks/useConnectivity', () => ({
  useConnectivity: () => ({ lastChecked: 1, apiReachable: true, clerkToken: true }),
}));
vi.mock('@features/subscription/api/useSubscription', () => {
  const mutation = () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() });
  return {
    useSubscriptionDetails: () => ({ data: undefined }),
    useSubscriptionInvoices: () => ({ data: undefined, isLoading: false }),
    useSubscriptionPlans: () => ({ data: undefined }),
    useCancelSubscription: () => ({ isPending: false, mutateAsync: cancel }),
    useResumeSubscription: mutation,
    useUpdateSubscriptionPlan: mutation,
    useCustomerPortal: mutation,
    useCreateCheckout: mutation,
  };
});

const { useSubscriptionViewModel } = await import('./useSubscriptionViewModel');

describe('Subscription Canceled analytics', () => {
  beforeEach(() => {
    trackSubscriptionCanceled.mockClear();
    cancel.mockClear();
  });

  it("sends 'other' and never the typed note", async () => {
    const { result } = renderHook(() => useSubscriptionViewModel());
    act(() => {
      result.current.setCancelReason('other');
      result.current.setCancelReasonNotes('My bank Foo Ltd is too slow, call me at 555-1234');
    });
    await act(async () => {
      await result.current.handleCancelSubscription();
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(trackSubscriptionCanceled).toHaveBeenCalledWith('other');
    expect(JSON.stringify(trackSubscriptionCanceled.mock.calls)).not.toContain('Foo');
  });

  it('sends the chosen fixed option', async () => {
    const { result } = renderHook(() => useSubscriptionViewModel());
    act(() => result.current.setCancelReason('too_expensive'));
    await act(async () => {
      await result.current.handleCancelSubscription();
    });
    expect(trackSubscriptionCanceled).toHaveBeenCalledWith('too_expensive');
  });
});
