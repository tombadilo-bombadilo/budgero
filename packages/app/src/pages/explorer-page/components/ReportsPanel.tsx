import { Trans } from '@lingui/react/macro';
import { memo } from 'react';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { ScrollArea } from '@shared/ui/scroll-area';
import { Edit, Pin } from 'lucide-react';
import type { UnifiedReport } from '@budgero/core/browser';
import { isBuilderQuery } from '@features/reports/lib/report-builder';

export interface ReportsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedReports: UnifiedReport[];
  onLoadReport: (report: UnifiedReport) => void;
  onEditReport: (report: UnifiedReport) => void;
  onDeleteReport: (reportId: string) => void;
  onPinChart: (report: UnifiedReport) => void;
}

export const ReportsPanel = memo(
  ({
    open,
    onOpenChange,
    savedReports,
    onLoadReport,
    onEditReport,
    onDeleteReport,
    onPinChart,
  }: ReportsPanelProps) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            <Trans>Saved Reports ({savedReports.length})</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Load a previously saved query or manage your reports.</Trans>
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[400px]">
          {savedReports.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              <Trans>No saved reports yet. Save a query to get started.</Trans>
            </div>
          ) : (
            <div className="space-y-2">
              {savedReports.map((report) => (
                <div
                  key={report.id}
                  className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{report.name}</h4>
                      {report.description && (
                        <p className="text-xs text-muted-foreground mt-1">{report.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span>
                          <Trans>Updated: {new Date(report.updatedAt).toLocaleDateString()}</Trans>
                        </span>
                        {isBuilderQuery(report.query) && (
                          <Badge variant="outline" className="text-xs">
                            <Trans>Builder</Trans>
                          </Badge>
                        )}
                        {report.isFavorite && (
                          <Badge variant="secondary" className="text-xs">
                            <Trans>Favorite</Trans>
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <Button size="sm" variant="outline" onClick={() => onLoadReport(report)}>
                        <Trans>Load</Trans>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onEditReport(report)}>
                        <Trans>
                          <Edit className="h-3 w-3 mr-1" />
                          Edit
                        </Trans>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onPinChart(report)}
                        disabled={!report.charts || report.charts.length === 0}
                      >
                        <Trans>
                          <Pin className="h-3 w-3 mr-1" />
                          Pin chart
                        </Trans>
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onDeleteReport(report.id)}
                      >
                        <Trans>Delete</Trans>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <Trans>Close</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
);

ReportsPanel.displayName = 'ReportsPanel';
