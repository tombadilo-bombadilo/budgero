import { useEffect, useState } from 'react';
import type { UnifiedReport } from '@budgero/core/browser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { useAsyncDialogAction } from '@shared/hooks/useAsyncDialogAction';
import { toast } from 'sonner';
import { useReportChartSelection } from './useReportChartSelection';
import { ReportChartSelectFields } from './ReportChartSelectFields';

interface AddWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reports: UnifiedReport[];
  onAddWidget: (input: {
    reportId: string;
    chartId: string;
    titleOverride?: string;
  }) => Promise<void>;
}

export function AddWidgetDialog({
  open,
  onOpenChange,
  reports,
  onAddWidget,
}: AddWidgetDialogProps) {
  const [titleOverride, setTitleOverride] = useState('');
  const {
    selectableReports,
    selectedReport,
    selectedReportId,
    setSelectedReportId,
    selectedChartId,
    setSelectedChartId,
  } = useReportChartSelection(reports, open);
  const { isRunning: isSubmitting, run: runSubmit } = useAsyncDialogAction({
    errorMessage: 'Failed to add widget',
    onSuccess: () => onOpenChange(false),
  });

  // Pre-existing reset-on-open pattern; the setState-in-effect call is an
  // intentional dialog-state reset.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-compiler/react-compiler
    setTitleOverride('');
  }, [open]);

  const handleSubmit = async () => {
    if (!selectedReportId || !selectedChartId) {
      toast.error('Please select a report and chart.');
      return;
    }

    await runSubmit(() =>
      onAddWidget({
        reportId: selectedReportId,
        chartId: selectedChartId,
        titleOverride: titleOverride.trim() || undefined,
      })
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>Select a saved chart to pin to this dashboard.</DialogDescription>
        </DialogHeader>

        {selectableReports.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            Save a report with at least one chart in Explorer first.
          </div>
        ) : (
          <div className="space-y-4">
            <ReportChartSelectFields
              selectableReports={selectableReports}
              selectedReportId={selectedReportId}
              onReportIdChange={setSelectedReportId}
              selectedReport={selectedReport}
              selectedChartId={selectedChartId}
              onChartIdChange={setSelectedChartId}
            />
            <div className="space-y-2">
              <Label htmlFor="titleOverride">Custom widget title (optional)</Label>
              <Input
                id="titleOverride"
                value={titleOverride}
                onChange={(event) => setTitleOverride(event.target.value)}
                placeholder="Leave blank to use chart title"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || selectableReports.length === 0 || !selectedChartId}
          >
            {isSubmitting ? 'Adding...' : 'Add Widget'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
