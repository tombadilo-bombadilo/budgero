import { Trans, useLingui } from '@lingui/react/macro';
import { trackSettingChanged } from '@shared/lib/analytics/track';
import { CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { useWeekStartsOnPreference } from '@shared/hooks/useUserPreferences';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';

export function CalendarSettingsCard() {
  const { t } = useLingui();

  const { weekStartsOn, updateWeekStartsOn, isLoading, isError, isUpdating } =
    useWeekStartsOnPreference();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <CalendarDays className="h-5 w-5" />
            Calendar
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Choose the first day of the week for calendars, weekly reports, and “this week” and
            “last week” searches in this workspace.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="week-starts-on">
          <Trans>First day of the week</Trans>
        </Label>
        <Select
          value={String(weekStartsOn)}
          disabled={isLoading || isError || isUpdating}
          onValueChange={(value) => {
            if (value !== '0' && value !== '1') return;
            trackSettingChanged('week_start', value === '1' ? 'monday' : 'sunday');
            updateWeekStartsOn(value === '1' ? 1 : 0, {
              onError: () => toast.error(t`Could not save the first day of the week`),
            });
          }}
        >
          <SelectTrigger id="week-starts-on" className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">
              <Trans>Sunday</Trans>
            </SelectItem>
            <SelectItem value="1">
              <Trans>Monday</Trans>
            </SelectItem>
          </SelectContent>
        </Select>
        {isError && (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not load calendar settings.</Trans>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
