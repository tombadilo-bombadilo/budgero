import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { BarChart3, ShieldAlert } from 'lucide-react';
import {
  isAnalyticsDisabled,
  enableAnalytics,
  disableAnalytics,
} from '@shared/lib/analytics/analytics';
import { setPostHogConsent, showKlaro } from '@shared/lib/analytics/klaro';
import {
  useProfile,
  useSetAnalyticsDisabled,
  useSetTrialSignalsDisabled,
} from '@entities/user/api/useAuth';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

/** Self-contained privacy/analytics card: owns its own state, sync effect, and mutation. */
export function PrivacySettingsCard() {
  const { data: profile } = useProfile();
  const setAnalyticsDisabledMutation = useSetAnalyticsDisabled();
  const setTrialSignalsDisabledMutation = useSetTrialSignalsDisabled();
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() => !isAnalyticsDisabled());

  const typedProfile = profile as import('@shared/model/auth').User | undefined;
  // Trial-reward tracking is server-side only (no local flag or PostHog
  // involvement) — the profile value is the single source of truth.
  const trialSignalsEnabled = typedProfile?.is_trial_signals_disabled !== true;

  // Sync analytics preference from server profile on load. The server value
  // is authoritative for signed-in users (new accounts are created with
  // analytics DISABLED — opt-in). Mirror into Klaro too, otherwise a
  // pre-seeded "rejected" consent could flip a server-enabled user back off.
  useEffect(() => {
    if (!IS_SELF_HOSTABLE_BUILD && typedProfile?.is_analytics_disabled !== undefined) {
      const serverDisabled = typedProfile.is_analytics_disabled;
      // eslint-disable-next-line react-compiler/react-compiler
      setAnalyticsEnabled(!serverDisabled);
      // Keep localStorage in sync with server state
      if (serverDisabled) {
        disableAnalytics();
      } else {
        enableAnalytics();
      }
      setPostHogConsent(!serverDisabled);
    }
  }, [typedProfile?.is_analytics_disabled]);

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled);
    if (enabled) {
      enableAnalytics();
    } else {
      disableAnalytics();
    }
    // Mirror into Klaro so the cookie banner doesn't reappear contradicting
    // the user's Settings choice. No-op on self-host (Klaro isn't loaded).
    setPostHogConsent(enabled);
    // Persist to server (SaaS only, fire-and-forget)
    if (!IS_SELF_HOSTABLE_BUILD) {
      setAnalyticsDisabledMutation.mutate({ disabled: !enabled });
    }
  };

  return (
    <Card className={IS_SELF_HOSTABLE_BUILD ? 'opacity-60' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Privacy Settings
        </CardTitle>
        <CardDescription>
          {IS_SELF_HOSTABLE_BUILD
            ? 'Analytics is not available in self-hosted builds.'
            : 'Control what anonymous usage data Budgero collects.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {IS_SELF_HOSTABLE_BUILD && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              Usage analytics is disabled and not included in self-hosted builds. No tracking code
              is loaded or executed.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label
              htmlFor="analytics-toggle"
              className={`text-sm font-medium ${IS_SELF_HOSTABLE_BUILD ? 'text-muted-foreground' : ''}`}
            >
              Usage Analytics
            </Label>
            <p className="text-sm text-muted-foreground">
              {IS_SELF_HOSTABLE_BUILD
                ? 'Not available in self-hosted builds.'
                : 'Help improve Budgero by sending anonymous usage events. Off by default — nothing is collected unless you turn this on.'}
            </p>
          </div>
          <Switch
            id="analytics-toggle"
            checked={IS_SELF_HOSTABLE_BUILD ? false : analyticsEnabled}
            onCheckedChange={handleAnalyticsToggle}
            disabled={IS_SELF_HOSTABLE_BUILD}
          />
        </div>

        {!IS_SELF_HOSTABLE_BUILD && (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="trial-signals-toggle" className="text-sm font-medium">
                Trial Reward Tracking
              </Label>
              <p className="text-sm text-muted-foreground">
                Counts your budgeting activity (event names only, no amounts or details) toward
                trial-reward tier unlocks. Separate from usage analytics. Turning this off pauses
                new tier unlocks until you turn it back on.
              </p>
            </div>
            <Switch
              id="trial-signals-toggle"
              checked={trialSignalsEnabled}
              onCheckedChange={(enabled) =>
                setTrialSignalsDisabledMutation.mutate({ disabled: !enabled })
              }
              disabled={setTrialSignalsDisabledMutation.isPending}
            />
          </div>
        )}

        {!IS_SELF_HOSTABLE_BUILD && (
          <div className="pt-4 border-t border-border/60 space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">What we collect</h3>
              <p className="text-sm text-muted-foreground">
                When enabled, we collect <strong>only the event name</strong> with no personal data,
                account information, or financial details. All analytics are completely anonymous.
              </p>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 p-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                Events we track
              </h4>
              <ul className="grid gap-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Transaction Logged / Edited / Deleted</strong> — when you add, modify,
                    or remove a transaction
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Account Added</strong> — when you create a new account
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Category Added / Edited / Deleted</strong> — when you manage categories
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Category Group Added / Edited / Deleted</strong> — when you manage
                    category groups
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Assignment Upserted</strong> — when you assign money to a category
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Budget Created</strong> — when you create a new budget
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Imported from YNAB / Imported CSV/PDF</strong> — when you import data
                    into a budget
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Shared Budget</strong> — when you create a workspace invite
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Trial Started</strong> — when your free trial begins
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Checkout Started / Purchase</strong> — subscription funnel events (plan,
                    price)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <strong>Subscription Canceled</strong> — cancellation reason (so we can improve
                    the product)
                  </span>
                </li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              We do not collect transaction amounts, payee names, category names, account balances,
              or any other financial information. Your budget data stays entirely private.
            </p>

            <div className="pt-2">
              <button
                type="button"
                onClick={showKlaro}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Manage cookies
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
