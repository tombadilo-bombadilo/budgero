import { useEffect, useState } from 'react';
import type { CustomDashboard, UnifiedReport } from '@budgero/core/browser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Label } from '@shared/ui/label';
import { useAsyncDialogAction } from '@shared/hooks/useAsyncDialogAction';
import { toast } from 'sonner';
import { useReportChartSelection } from './useReportChartSelection';
import { ReportChartSelectFields } from './ReportChartSelectFields';

interface PinChartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reports: UnifiedReport[];
  dashboards: CustomDashboard[];
  onPin: (selection: { dashboardId: string; reportId: string; chartId: string }) => Promise<void>;
  onCreateDashboard?: () => Promise<void>;
  defaultDashboardId?: string | null;
  defaultReportId?: string | null;
  defaultChartId?: string | null;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

export function PinChartDialog({
  open,
  onOpenChange,
  reports,
  dashboards,
  onPin,
  onCreateDashboard,
  defaultDashboardId,
  defaultReportId,
  defaultChartId,
  title = 'Pin Chart',
  description = 'Choose a report chart and target dashboard.',
  confirmLabel = 'Pin Chart',
}: PinChartDialogProps) {
  const [selectedDashboardId, setSelectedDashboardId] = useState('');
  const {
    selectableReports,
    selectedReport,
    selectedReportId,
    setSelectedReportId,
    selectedChartId,
    setSelectedChartId,
  } = useReportChartSelection(reports, open, {
    reportId: defaultReportId,
    chartId: defaultChartId,
  });
  const { isRunning: isSubmitting, run: runSubmit } = useAsyncDialogAction({
    errorMessage: 'Failed to pin chart',
    onSuccess: () => onOpenChange(false),
  });
  const { isRunning: isCreatingDashboard, run: runCreateDashboard } = useAsyncDialogAction({
    errorMessage: 'Failed to create dashboard',
  });

  // Pre-existing reset-on-open pattern; the setState-in-effect call is an
  // intentional dialog-state reset.
  useEffect(() => {
    if (!open) return;
    const fallbackDashboard = dashboards[0]?.id ?? '';
    // eslint-disable-next-line react-compiler/react-compiler
    setSelectedDashboardId(defaultDashboardId ?? fallbackDashboard);
  }, [open, dashboards, defaultDashboardId]);

  const handleSubmit = async () => {
    if (!selectedDashboardId || !selectedReportId || !selectedChartId) {
      toast.error('Please select dashboard, report, and chart.');
      return;
    }

    await runSubmit(() =>
      onPin({
        dashboardId: selectedDashboardId,
        reportId: selectedReportId,
        chartId: selectedChartId,
      })
    );
  };

  const handleCreateDashboard = async () => {
    if (!onCreateDashboard) return;
    await runCreateDashboard(() => onCreateDashboard());
  };

  const noDashboards = dashboards.length === 0;
  const noReports = selectableReports.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {(noDashboards || noReports) && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground space-y-2">
            {noDashboards && <p>Create a dashboard first to pin charts.</p>}
            {noReports && <p>No saved report with chart configuration is available yet.</p>}
            {noDashboards && onCreateDashboard && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreateDashboard}
                disabled={isCreatingDashboard}
              >
                {isCreatingDashboard ? 'Creating...' : 'Create "My Dashboard"'}
              </Button>
            )}
          </div>
        )}

        {!noDashboards && !noReports && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Dashboard</Label>
              <Select value={selectedDashboardId} onValueChange={setSelectedDashboardId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select dashboard" />
                </SelectTrigger>
                <SelectContent>
                  {dashboards.map((dashboard) => (
                    <SelectItem key={dashboard.id} value={dashboard.id}>
                      {dashboard.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ReportChartSelectFields
              selectableReports={selectableReports}
              selectedReportId={selectedReportId}
              onReportIdChange={setSelectedReportId}
              selectedReport={selectedReport}
              selectedChartId={selectedChartId}
              onChartIdChange={setSelectedChartId}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || noDashboards || noReports || isCreatingDashboard}
          >
            {isSubmitting ? 'Saving...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
