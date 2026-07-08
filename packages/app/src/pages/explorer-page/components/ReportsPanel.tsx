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
          <DialogTitle>Saved Reports ({savedReports.length})</DialogTitle>
          <DialogDescription>
            Load a previously saved query or manage your reports.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[400px]">
          {savedReports.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No saved reports yet. Save a query to get started.
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
                        <span>Updated: {new Date(report.updatedAt).toLocaleDateString()}</span>
                        {report.isFavorite && (
                          <Badge variant="secondary" className="text-xs">
                            Favorite
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <Button size="sm" variant="outline" onClick={() => onLoadReport(report)}>
                        Load
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onEditReport(report)}>
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onPinChart(report)}
                        disabled={!report.charts || report.charts.length === 0}
                      >
                        <Pin className="h-3 w-3 mr-1" />
                        Pin chart
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onDeleteReport(report.id)}
                      >
                        Delete
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
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
);

ReportsPanel.displayName = 'ReportsPanel';
