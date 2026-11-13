import { Trans } from '@lingui/react/macro';
import { ListChecks } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { useFirstStepsVisibility } from '../model/visibility';

/**
 * Budget Settings: show or hide the first-steps list. Only for a workspace
 * that has one (set up through "Start my own budget" on this device).
 */
export function FirstStepsSettingsCard() {
  const { available, hidden, show, hide } = useFirstStepsVisibility();
  if (!available) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-5 w-5" />
          <Trans>First steps</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>The short checklist for your first week.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="show-first-steps" className="font-medium">
            <Trans>Show first steps on the Planning page</Trans>
          </Label>
          <Switch
            id="show-first-steps"
            checked={!hidden}
            onCheckedChange={(checked) => (checked ? show() : hide())}
          />
        </div>
      </CardContent>
    </Card>
  );
}
