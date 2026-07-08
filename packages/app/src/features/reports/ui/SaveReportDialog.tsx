import { useCallback, useState, useEffect } from 'react';
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
import { Field } from '@shared/ui/field';
import { Textarea } from '@shared/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Separator } from '@shared/ui/separator';
import { Plus, X, BarChart3, Edit } from 'lucide-react';
import { toast } from 'sonner';
import type { ChartConfiguration, UnifiedReport } from '@budgero/core/browser';
import {
  getVisualizationDisplayName,
  type ExtendedChartType,
} from '@shared/lib/analytics/visualization-labels';
import { getErrorMessage } from '@shared/lib/errors';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';

interface SaveReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sqlQuery: string;
  queryResult: QueryResult | null;
  onSave: (data: {
    name: string;
    description?: string;
    query: string;
    charts: ChartConfiguration[];
  }) => Promise<UnifiedReport>;
  onSaveAndPin?: (savedReport: UnifiedReport) => void;
  initialData?: {
    name: string;
    description?: string;
    charts: ChartConfiguration[];
  };
  mode: 'create' | 'edit';
}

interface ChartFormData {
  id?: string;
  chartType: ExtendedChartType;
  title: string;
  xAxisColumn: string;
  yAxisColumn: string;
  groupByColumn: string;
  aggregateFunction: ChartConfiguration['aggregateFunction'];
}

function chartConfigToFormData(chart: ChartConfiguration): ChartFormData {
  return {
    id: chart.id,
    chartType: chart.chartType,
    title: chart.title || '',
    xAxisColumn: chart.xAxisColumn,
    yAxisColumn: chart.yAxisColumn,
    groupByColumn: chart.groupByColumn || '__none__',
    aggregateFunction: chart.aggregateFunction,
  };
}

// Stat cards don't use labels; keep x-axis populated for config compatibility.
function normalizeStatXAxis(
  chart: Pick<ChartFormData, 'chartType' | 'xAxisColumn' | 'yAxisColumn'>
): string {
  return chart.chartType === 'stat' ? chart.yAxisColumn : chart.xAxisColumn;
}

const defaultChartForm: ChartFormData = {
  id: undefined,
  chartType: 'bar',
  title: '',
  xAxisColumn: '',
  yAxisColumn: '',
  groupByColumn: '__none__',
  aggregateFunction: 'SUM',
};

interface ColumnSelectProps {
  value: string;
  columns: string[] | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Prepend a "None" option mapped to the `__none__` sentinel. */
  includeNone?: boolean;
}

function ColumnSelect({
  value,
  columns,
  onChange,
  placeholder,
  includeNone = false,
}: ColumnSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {includeNone && <SelectItem value="__none__">None</SelectItem>}
        {columns?.map((column) => (
          <SelectItem key={column} value={column}>
            {column}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SaveReportDialog({
  open,
  onOpenChange,
  sqlQuery,
  queryResult,
  onSave,
  onSaveAndPin,
  initialData,
  mode,
}: SaveReportDialogProps) {
  const [reportName, setReportName] = useState(initialData?.name || '');
  const [reportDescription, setReportDescription] = useState(initialData?.description || '');
  const [charts, setCharts] = useState<ChartFormData[]>(
    initialData?.charts?.map(chartConfigToFormData) ?? []
  );
  const [isAddingChart, setIsAddingChart] = useState(false);
  const [newChart, setNewChart] = useState<ChartFormData>(defaultChartForm);
  const [isSaving, setIsSaving] = useState(false);

  const resetForm = useCallback(() => {
    setReportName(initialData?.name || '');
    setReportDescription(initialData?.description || '');
    setCharts(initialData?.charts?.map(chartConfigToFormData) ?? []);
    setIsAddingChart(false);
    setNewChart(defaultChartForm);
  }, [initialData]);

  // Update form when initialData changes (e.g., when loading a different report)
  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open, resetForm]);

  const handleClose = () => {
    if (!isSaving) {
      onOpenChange(false);
      resetForm();
    }
  };

  const handleAddChart = () => {
    if (!queryResult || queryResult.columns.length === 0) {
      toast.error('No query results available to create chart');
      return;
    }

    if (!hasRequiredColumns) {
      toast.error(
        isStat ? 'Please select a metric column' : 'Please select both X and Y axis columns'
      );
      return;
    }

    setCharts((prev) => [
      ...prev,
      {
        ...newChart,
        xAxisColumn: normalizeStatXAxis(newChart),
      },
    ]);
    setNewChart(defaultChartForm);
    setIsAddingChart(false);
    toast.success('Chart added to report');
  };

  const handleRemoveChart = (index: number) => {
    setCharts((prev) => prev.filter((_, i) => i !== index));
    toast.success('Chart removed from report');
  };

  const handleSave = async (pinAfterSave = false) => {
    if (!reportName.trim()) {
      toast.error('Please enter a report name');
      return;
    }

    if (!sqlQuery.trim()) {
      toast.error('No SQL query to save');
      return;
    }

    setIsSaving(true);
    try {
      const chartConfigs: ChartConfiguration[] = charts.map((chart) => ({
        id: chart.id ?? crypto.randomUUID(),
        chartType: chart.chartType as ChartConfiguration['chartType'],
        title: chart.title.trim() || undefined,
        xAxisColumn: normalizeStatXAxis(chart),
        yAxisColumn: chart.yAxisColumn,
        groupByColumn: chart.groupByColumn === '__none__' ? undefined : chart.groupByColumn,
        aggregateFunction: chart.aggregateFunction,
      }));

      const savedReport = await onSave({
        name: reportName.trim(),
        description: reportDescription.trim() || undefined,
        query: sqlQuery,
        charts: chartConfigs,
      });

      toast.success(`Report ${mode === 'create' ? 'created' : 'updated'} successfully`);
      if (pinAfterSave && onSaveAndPin) {
        onSaveAndPin(savedReport);
      }
      handleClose();
    } catch (error) {
      const message = getErrorMessage(
        error,
        `Failed to ${mode === 'create' ? 'create' : 'update'} report`
      );
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const canAddChart = queryResult && queryResult.columns.length > 0;
  const isStat = newChart.chartType === 'stat';
  const hasRequiredColumns = isStat
    ? Boolean(newChart.yAxisColumn)
    : Boolean(newChart.xAxisColumn && newChart.yAxisColumn);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Save Report' : 'Edit Report'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Save your SQL query as a reusable report. Optionally add chart visualizations.'
              : 'Update your report and chart configurations.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Report Details */}
          <div className="space-y-4">
            <Field label="Report Name *" htmlFor="name" className="space-y-2">
              <Input
                id="name"
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder="Enter report name..."
                disabled={isSaving}
              />
            </Field>

            <Field label="Description" htmlFor="description" className="space-y-2">
              <Textarea
                id="description"
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
                disabled={isSaving}
              />
            </Field>
          </div>

          <Separator />

          {/* Charts Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">Chart Visualizations</h3>
                <p className="text-sm text-muted-foreground">
                  Add charts to visualize your query results
                </p>
              </div>
              {canAddChart && !isAddingChart && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddingChart(true)}
                  disabled={isSaving}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Chart
                </Button>
              )}
            </div>

            {!canAddChart && (
              <Card>
                <CardContent className="flex items-center justify-center py-6">
                  <div className="text-center text-muted-foreground">
                    <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Run a query first to add charts</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Existing Charts */}
            {charts.length > 0 && (
              <div className="space-y-3">
                {charts.map((chart, index) => (
                  <Card key={index}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          {getVisualizationDisplayName(chart)}
                        </CardTitle>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setNewChart(chart);
                              setIsAddingChart(true);
                              // Remove the chart from list (it will be re-added when saved)
                              handleRemoveChart(index);
                            }}
                            disabled={isSaving}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveChart(index)}
                            disabled={isSaving}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">{chart.chartType}</Badge>
                        {chart.chartType !== 'stat' && <span>X: {chart.xAxisColumn}</span>}
                        <span>
                          {chart.chartType === 'stat' ? 'Metric' : 'Y'}: {chart.aggregateFunction}(
                          {chart.yAxisColumn})
                        </span>
                        {chart.groupByColumn !== '__none__' && (
                          <span>Group: {chart.groupByColumn}</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Add/Edit Chart Form */}
            {isAddingChart && canAddChart && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {newChart.xAxisColumn ? 'Edit' : 'Add'} Chart Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Chart Type" className="space-y-2">
                      <Select
                        value={newChart.chartType}
                        onValueChange={(value) =>
                          setNewChart((prev) => ({
                            ...prev,
                            chartType: value as ExtendedChartType,
                            groupByColumn:
                              value === 'pie' || value === 'stat' ? '__none__' : prev.groupByColumn,
                            xAxisColumn:
                              value === 'stat'
                                ? prev.yAxisColumn || prev.xAxisColumn
                                : prev.xAxisColumn,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bar">Bar Chart</SelectItem>
                          <SelectItem value="line">Line Chart</SelectItem>
                          <SelectItem value="area">Area Chart</SelectItem>
                          <SelectItem value="pie">Pie Chart</SelectItem>
                          <SelectItem value="scatter">Scatter Plot</SelectItem>
                          <SelectItem value="table">Table</SelectItem>
                          <SelectItem value="stat">Stat</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="Title (Optional)" className="space-y-2">
                      <Input
                        value={newChart.title}
                        onChange={(e) =>
                          setNewChart((prev) => ({ ...prev, title: e.target.value }))
                        }
                        placeholder="Chart title..."
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {newChart.chartType !== 'stat' && (
                      <Field
                        label={`${newChart.chartType === 'pie' ? 'Labels' : 'X-Axis'} *`}
                        className="space-y-2"
                      >
                        <ColumnSelect
                          value={newChart.xAxisColumn}
                          columns={queryResult?.columns}
                          onChange={(value) =>
                            setNewChart((prev) => ({ ...prev, xAxisColumn: value }))
                          }
                          placeholder="Select column"
                        />
                      </Field>
                    )}

                    <Field
                      label={`${
                        newChart.chartType === 'pie'
                          ? 'Values'
                          : newChart.chartType === 'stat'
                            ? 'Metric Column'
                            : 'Y-Axis'
                      } *`}
                      className={
                        newChart.chartType === 'stat' ? 'sm:col-span-2 space-y-2' : 'space-y-2'
                      }
                    >
                      <ColumnSelect
                        value={newChart.yAxisColumn}
                        columns={queryResult?.columns}
                        onChange={(value) =>
                          setNewChart((prev) => ({ ...prev, yAxisColumn: value }))
                        }
                        placeholder="Select column"
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {!['pie', 'stat'].includes(newChart.chartType) && (
                      <Field label="Group By" className="space-y-2">
                        <ColumnSelect
                          value={newChart.groupByColumn}
                          columns={queryResult?.columns}
                          onChange={(value) =>
                            setNewChart((prev) => ({ ...prev, groupByColumn: value }))
                          }
                          includeNone
                        />
                      </Field>
                    )}

                    <Field
                      label="Aggregate Function"
                      className={
                        ['pie', 'stat'].includes(newChart.chartType)
                          ? 'sm:col-span-2 space-y-2'
                          : 'space-y-2'
                      }
                    >
                      <Select
                        value={newChart.aggregateFunction}
                        onValueChange={(value) =>
                          setNewChart((prev) => ({
                            ...prev,
                            aggregateFunction: value as ChartConfiguration['aggregateFunction'],
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SUM">Sum</SelectItem>
                          <SelectItem value="COUNT">Count</SelectItem>
                          <SelectItem value="AVG">Average</SelectItem>
                          <SelectItem value="MAX">Maximum</SelectItem>
                          <SelectItem value="MIN">Minimum</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsAddingChart(false);
                        setNewChart(defaultChartForm);
                      }}
                      className="w-full sm:w-auto"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleAddChart}
                      disabled={!hasRequiredColumns}
                      className="w-full sm:w-auto"
                    >
                      {hasRequiredColumns ? 'Update' : 'Add'} Chart
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave(false)}
            disabled={!reportName.trim() || isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? 'Saving...' : mode === 'create' ? 'Save Report' : 'Update Report'}
          </Button>
          <Button
            onClick={() => void handleSave(true)}
            disabled={!reportName.trim() || isSaving || charts.length === 0}
            className="w-full sm:w-auto"
            variant="secondary"
          >
            {isSaving ? 'Saving...' : mode === 'create' ? 'Save & Pin' : 'Update & Pin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
