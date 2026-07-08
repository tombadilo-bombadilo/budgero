import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Switch } from '@shared/ui/switch';
import { Label } from '@shared/ui/label';
import { AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { useAllowOverAssignmentPreference } from '@shared/hooks/useUserPreferences';
import { cn } from '@shared/lib/utils';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

export default function BudgetSettingsPage() {
  const { allowOverAssignment, isLoading, updateAllowOverAssignment, isUpdating } =
    useAllowOverAssignmentPreference();

  const handleToggle = (checked: boolean) => {
    updateAllowOverAssignment(checked);
  };

  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title="Budget Settings"
        description="Configure how Budgero handles your budget assignments and constraints."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" />
            Assignment Behavior
          </CardTitle>
          <CardDescription>
            Control whether Budgero enforces the Ready to Assign limit when funding categories.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="allow-over-assignment" className="font-medium">
                  Allow over-assignment
                </Label>
                {allowOverAssignment && (
                  <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Enabled
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground max-w-md">
                When enabled, you can assign more money to categories than you have available in
                Ready to Assign. This will result in a negative Ready to Assign amount.
              </p>
            </div>
            <Switch
              id="allow-over-assignment"
              checked={allowOverAssignment}
              onCheckedChange={handleToggle}
              disabled={isLoading || isUpdating}
              className={cn(
                'data-[state=checked]:bg-yellow-500',
                isUpdating && 'opacity-50 cursor-not-allowed'
              )}
            />
          </div>

          <div className="rounded-lg border bg-muted/50 p-4">
            <h4 className="text-sm font-medium mb-2">What this means</h4>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
              <li>
                <strong className="text-foreground">Disabled (default):</strong> Budgero prevents
                you from assigning more than your Ready to Assign amount. You must have cash
                available before funding categories.
              </li>
              <li>
                <strong className="text-foreground">Enabled:</strong> You can assign any amount to
                categories regardless of Ready to Assign. This creates negative Ready to Assign,
                indicating you&apos;ve assigned more money than you currently have.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
