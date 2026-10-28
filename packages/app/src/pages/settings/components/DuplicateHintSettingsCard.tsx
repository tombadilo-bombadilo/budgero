import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { CopyCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { DuplicateHintSettings } from '@budgero/core/browser';
import { useDuplicateHintSettingsPreference } from '@shared/hooks/useUserPreferences';
import { getLocaleTag } from '@shared/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Switch } from '@shared/ui/switch';

const TOLERANCE_OPTIONS = [0, 50, 100, 200, 500];
const DAY_WINDOW_OPTIONS = [3, 5, 7, 14];

/** Keep a saved value selectable even if it is not one of the presets. */
const withCurrent = (options: number[], current: number) =>
  options.includes(current) ? options : [...options, current].sort((a, b) => a - b);

export function DuplicateHintSettingsCard() {
  const { t } = useLingui();
  const { settings, updateSettings, isLoading, isError, isUpdating } =
    useDuplicateHintSettingsPreference();
  const disabled = isLoading || isError || isUpdating;

  const save = (patch: Partial<DuplicateHintSettings>) =>
    updateSettings(patch, {
      onError: () => toast.error(t`Could not save duplicate transaction settings`),
    });

  const percent = new Intl.NumberFormat(getLocaleTag(), {
    style: 'percent',
    maximumFractionDigits: 1,
  });
  const toleranceLabel = (bps: number) => {
    const tolerance = percent.format(bps / 10_000);
    return bps === 0 ? t`Exact (±0.01)` : t`Within ${tolerance}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <CopyCheck className="h-5 w-5" />
            Duplicate transactions
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Warn while adding a transaction by hand if it looks like one already in the account.
            Statement imports use the same amount and date range to find transactions to match.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="duplicate-hints-enabled">
            <Trans>Warn about possible duplicates</Trans>
          </Label>
          <Switch
            id="duplicate-hints-enabled"
            checked={settings.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => save({ enabled })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="duplicate-amount-tolerance">
              <Trans>Amount</Trans>
            </Label>
            <Select
              value={String(settings.toleranceBps)}
              disabled={disabled || !settings.enabled}
              onValueChange={(value) => save({ toleranceBps: Number(value) })}
            >
              <SelectTrigger id="duplicate-amount-tolerance" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(TOLERANCE_OPTIONS, settings.toleranceBps).map((bps) => (
                  <SelectItem key={bps} value={String(bps)}>
                    {toleranceLabel(bps)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="duplicate-day-window">
              <Trans>Date range</Trans>
            </Label>
            <Select
              value={String(settings.dayWindow)}
              disabled={disabled || !settings.enabled}
              onValueChange={(value) => save({ dayWindow: Number(value) })}
            >
              <SelectTrigger id="duplicate-day-window" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(DAY_WINDOW_OPTIONS, settings.dayWindow).map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {plural(days, { one: '±# day', other: '±# days' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {isError && (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not load duplicate transaction settings.</Trans>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
