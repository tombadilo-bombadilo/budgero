import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useProfile, useSetAnalyticsDisabled } from '@entities/user/api/useAuth';
import { useUiStore } from '@shared/store/useUiStore';
import {
  clearLegacyConsent,
  hasLegacyLocalOptOut,
  setAnalyticsBudgetContext,
  setAnalyticsSubject,
} from '@shared/lib/analytics/analytics';

/**
 * Cloud only (mounted inside ClerkProvider). Tells analytics who is using the
 * app, so nothing is sent before we know whether the user opted out:
 * signed out → anonymous; signed in → wait for the profile, then honour
 * `is_analytics_disabled`. Also migrates an explicit opt-out from the old
 * local consent model to the server, once.
 */
export function AnalyticsGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: profile } = useProfile();
  const setDisabled = useSetAnalyticsDisabled();
  const migratingRef = useRef(false);
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

  // One-time migration: a local 'denied' becomes the server opt-out. Until the
  // server confirms, hasLegacyLocalOptOut() keeps analytics off.
  const { mutate } = setDisabled;
  useEffect(() => {
    if (!userId || serverDisabled === undefined || migratingRef.current) return;
    if (!hasLegacyLocalOptOut()) return;
    if (serverDisabled) {
      clearLegacyConsent();
      return;
    }
    migratingRef.current = true;
    mutate(
      { disabled: true },
      {
        onSuccess: () => clearLegacyConsent(),
        onSettled: () => {
          migratingRef.current = false;
        },
      }
    );
  }, [userId, serverDisabled, mutate]);

  useEffect(() => {
    setAnalyticsBudgetContext(rtaMode);
  }, [rtaMode]);

  return null;
}
