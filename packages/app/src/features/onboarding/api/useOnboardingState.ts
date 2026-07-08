import { useProfile } from '@entities/user/api/useAuth';
import type { OnboardingStatus } from '@shared/model/auth';

const DEFAULT_STATUS: OnboardingStatus = 'pending';

export type OnboardingState = {
  status: OnboardingStatus;
  snoozedUntil: string | null;
};

export function useOnboardingState(): OnboardingState {
  const { data: profile } = useProfile();

  return {
    status: profile?.onboarding_status ?? DEFAULT_STATUS,
    snoozedUntil: profile?.onboarding_snoozed_until ?? null,
  };
}
