import type { UnifiedReport } from '@budgero/core/browser';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Label } from '@shared/ui/label';
import { getVisualizationDisplayName } from '@shared/lib/analytics/visualization-labels';

interface ReportChartSelectFieldsProps {
  selectableReports: UnifiedReport[];
  selectedReportId: string;
  onReportIdChange: (id: string) => void;
  selectedReport: UnifiedReport | null;
  selectedChartId: string;
  onChartIdChange: (id: string) => void;
}

/** The Report + Chart `Select` pair shared by the widget-add and chart-pin dialogs. */
export function ReportChartSelectFields({
  selectableReports,
  selectedReportId,
  onReportIdChange,
  selectedReport,
  selectedChartId,
  onChartIdChange,
}: ReportChartSelectFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>Report</Label>
        <Select value={selectedReportId} onValueChange={onReportIdChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select report" />
          </SelectTrigger>
          <SelectContent>
            {selectableReports.map((report) => (
              <SelectItem key={report.id} value={report.id}>
                {report.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Chart</Label>
        <Select value={selectedChartId} onValueChange={onChartIdChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select chart" />
          </SelectTrigger>
          <SelectContent>
            {(selectedReport?.charts ?? []).map((chart) => (
              <SelectItem key={chart.id} value={chart.id}>
                {getVisualizationDisplayName(chart)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
