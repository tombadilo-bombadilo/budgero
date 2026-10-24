import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useProfile } from '@entities/user/api/useAuth';
import { useUiStore } from '@shared/store/useUiStore';
import { setAnalyticsBudgetContext, setAnalyticsSubject } from '@shared/lib/analytics/analytics';

/**
 * Cloud only (mounted inside ClerkProvider). Tells analytics who is using the
 * app, so nothing is sent before we know whether the user opted out:
 * signed out → anonymous; signed in → wait for the profile, then honour
 * `is_analytics_disabled` (the only opt-out that counts; old local consent
 * keys are dropped at startup).
 */
export function AnalyticsGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: profile } = useProfile();
  const rtaMode = useUiStore((state) => state.selectedBudget?.RtaMode ?? null);

  const userId = profile?.id ?? null;
  const serverDisabled = profile?.is_analytics_disabled;

  useEffect(() => {
    if (!isLoaded) {
      setAnalyticsSubject({ kind: 'pending' });
      return;
    }
    if (!isSignedIn) {
      setAnalyticsSubject({ kind: 'anonymous' });
      return;
    }
    if (!userId || serverDisabled === undefined) {
      setAnalyticsSubject({ kind: 'pending' });
      return;
    }
    setAnalyticsSubject({ kind: 'user', id: userId, optedOut: serverDisabled });
  }, [isLoaded, isSignedIn, userId, serverDisabled]);

  useEffect(() => {
    setAnalyticsBudgetContext(rtaMode);
  }, [rtaMode]);

  return null;
}
