import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscriptionApi } from '@shared/api/api-client';
import { toast } from 'sonner';

export function useSubscriptionPlans() {
  return useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: subscriptionApi.getPlans,
    staleTime: 1000 * 60 * 30, // 30 minutes - plans don't change often
  });
}

export function useSubscriptionInvoices() {
  return useQuery({
    queryKey: ['subscription', 'invoices'],
    queryFn: subscriptionApi.getInvoices,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useSubscriptionDetails(subscriptionId?: string) {
  return useQuery({
    queryKey: ['subscription', 'details', subscriptionId ?? 'none'],
    queryFn: subscriptionApi.getDetails,
    enabled: !!subscriptionId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: subscriptionApi.cancelSubscription,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });

      toast.success('Subscription Cancelled', {
        description:
          'Your subscription has been cancelled. You will have access until the end of the billing period.',
      });
    },
    onError: () => {
      toast.error('Error', {
        description: 'Failed to cancel subscription. Please try again.',
      });
    },
  });
}

export function useResumeSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: subscriptionApi.resumeSubscription,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });

      toast.success('Subscription Resumed', {
        description: 'Your subscription has been resumed successfully.',
      });
    },
    onError: () => {
      toast.error('Error', {
        description: 'Failed to resume subscription. Please try again.',
      });
    },
  });
}

export function useUpdateSubscriptionPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variantId: string) => subscriptionApi.updatePlan(variantId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['profile'] }),
        queryClient.refetchQueries({ queryKey: ['subscription'] }),
      ]);

      toast.success('Plan Updated', {
        description: 'Your subscription plan has been updated successfully.',
      });
    },
    onError: () => {
      toast.error('Error', {
        description: 'Failed to update plan. Please try again.',
      });
    },
  });
}

// Create checkout session mutation. discountCode is optional and, when set,
// is forwarded to the server which validates ownership and forwards it to
// LemonSqueezy as the pre-applied discount.
export function useCreateCheckout() {
  return useMutation({
    mutationFn: ({ variantId, discountCode }: { variantId: string; discountCode?: string }) =>
      subscriptionApi.createCheckout(variantId, discountCode),
    onSuccess: (data) => {
      window.open(data.url, '_blank');
    },
    onError: () => {
      toast.error('Error', {
        description: 'Failed to create checkout session. Please try again.',
      });
    },
  });
}

export function useCustomerPortal() {
  return useMutation({
    mutationFn: subscriptionApi.getCustomerPortal,
    onSuccess: (data) => {
      window.open(data.url, '_blank');
    },
    onError: () => {
      toast.error('Error', {
        description: 'Failed to open billing portal. Please try again.',
      });
    },
  });
}
