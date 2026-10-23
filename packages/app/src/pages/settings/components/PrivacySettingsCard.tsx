import { Trans, useLingui } from '@lingui/react/macro';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { BarChart3, ShieldAlert } from 'lucide-react';
import { setAnalyticsOptOut } from '@shared/lib/analytics/analytics';
import { useProfile, useSetAnalyticsDisabled } from '@entities/user/api/useAuth';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

/**
 * Product analytics opt-out. The choice is saved on the server
 * (`is_analytics_disabled`), which also stops server-side events; analytics.ts
 * honours it right away for this session.
 */
export function PrivacySettingsCard() {
  const { t } = useLingui();
  const { data: profile } = useProfile();
  const setAnalyticsDisabledMutation = useSetAnalyticsDisabled();

  const serverDisabled = profile?.is_analytics_disabled ?? false;
  const pendingDisabled = setAnalyticsDisabledMutation.isPending
    ? setAnalyticsDisabledMutation.variables?.disabled
    : undefined;
  const analyticsEnabled = !(pendingDisabled ?? serverDisabled);

  const handleAnalyticsToggle = (enabled: boolean) => {
    if (IS_SELF_HOSTABLE_BUILD) return;
    setAnalyticsOptOut(!enabled);
    setAnalyticsDisabledMutation.mutate(
      { disabled: !enabled },
      // The server still holds the old value: go back to it.
      { onError: () => setAnalyticsOptOut(serverDisabled) }
    );
  };

  return (
    <Card className={IS_SELF_HOSTABLE_BUILD ? 'opacity-60' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <BarChart3 className="h-5 w-5" />
            Privacy Settings
          </Trans>
        </CardTitle>
        <CardDescription>
          {IS_SELF_HOSTABLE_BUILD
            ? t`Analytics is not available in self-hosted builds.`
            : t`Control the product analytics Budgero collects.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {IS_SELF_HOSTABLE_BUILD && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              <Trans>
                Usage analytics is disabled and not included in self-hosted builds. No tracking code
                is loaded or executed.
              </Trans>
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label
              htmlFor="analytics-toggle"
              className={`text-sm font-medium ${IS_SELF_HOSTABLE_BUILD ? 'text-muted-foreground' : ''}`}
            >
              <Trans>Usage Analytics</Trans>
            </Label>
            <p className="text-sm text-muted-foreground">
              {IS_SELF_HOSTABLE_BUILD
                ? t`Not available in self-hosted builds.`
                : t`On by default. Tells us which features you use, linked to your account ID, so we can improve Budgero. Turning it off also stops the events our server records.`}
            </p>
          </div>
          <Switch
            id="analytics-toggle"
            checked={IS_SELF_HOSTABLE_BUILD ? false : analyticsEnabled}
            onCheckedChange={handleAnalyticsToggle}
            disabled={IS_SELF_HOSTABLE_BUILD || !profile}
          />
        </div>

        {!IS_SELF_HOSTABLE_BUILD && (
          <div className="pt-4 border-t border-border/60 space-y-4">
            <div className="rounded-md border border-border/60 bg-muted/20 p-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                <Trans>What we collect</Trans>
              </h3>
              <ul className="grid gap-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <Trans>
                      Which features you use, with fixed options such as the setting you changed or
                      the import type, and rough counts like “10-100 rows”.
                    </Trans>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <Trans>
                      Whether it worked, with our own error code. Crash reports contain the error
                      type and code location, never the message.
                    </Trans>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <Trans>
                      Your app version, language, and whether you use the web or the installed app.
                    </Trans>
                  </span>
                </li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              <Trans>
                No cookies are used. We never collect amounts, balances, payee, category or account
                names, notes, your messages to the AI assistant, or anything else you type.
              </Trans>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
