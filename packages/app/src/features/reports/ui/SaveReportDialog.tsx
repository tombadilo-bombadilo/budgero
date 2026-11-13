import { Trans, useLingui } from '@lingui/react/macro';
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
        {includeNone && (
          <SelectItem value="__none__">
            <Trans>None</Trans>
          </SelectItem>
        )}
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
  const { t } = useLingui();

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
      toast.error(t`No query results available to create chart`);
      return;
    }

    if (!hasRequiredColumns) {
      toast.error(
        isStat ? t`Please select a metric column` : t`Please select both X and Y axis columns`
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
    toast.success(t`Chart added`);
  };

  const handleRemoveChart = (index: number) => {
    setCharts((prev) => prev.filter((_, i) => i !== index));
    toast.success(t`Chart removed`);
  };

  const handleSave = async (pinAfterSave = false) => {
    if (!reportName.trim()) {
      toast.error(t`Please enter a name`);
      return;
    }

    if (!sqlQuery.trim()) {
      toast.error(t`No SQL query to save`);
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

      toast.success(mode === 'create' ? t`Question saved` : t`Question updated`);
      if (pinAfterSave && onSaveAndPin) {
        onSaveAndPin(savedReport);
      }
      handleClose();
    } catch (error) {
      const message = getErrorMessage(error, t`Failed to save the question`);
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
          <DialogTitle>{mode === 'create' ? t`Save question` : t`Update question`}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? t`Save the SQL as a question. Add charts to draw its result.`
              : t`Update the question and its charts.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Report Details */}
          <div className="space-y-4">
            <Field label={t`Name *`} htmlFor="name" className="space-y-2">
              <Input
                id="name"
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder={t`Name the question…`}
                disabled={isSaving}
              />
            </Field>

            <Field label={t`Description`} htmlFor="description" className="space-y-2">
              <Textarea
                id="description"
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                placeholder={t`Optional description...`}
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
                <h3 className="font-medium">
                  <Trans>Charts</Trans>
                </h3>
                <p className="text-sm text-muted-foreground">
                  <Trans>Add charts to visualize your query results</Trans>
                </p>
              </div>
              {canAddChart && !isAddingChart && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddingChart(true)}
                  disabled={isSaving}
                >
                  <Trans>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Chart
                  </Trans>
                </Button>
              )}
            </div>

            {!canAddChart && (
              <Card>
                <CardContent className="flex items-center justify-center py-6">
                  <div className="text-center text-muted-foreground">
                    <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                      <Trans>Run a query first to add charts</Trans>
                    </p>
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
                          {chart.chartType === 'stat' ? t`Metric` : 'Y'}: {chart.aggregateFunction}(
                          {chart.yAxisColumn})
                        </span>
                        {chart.groupByColumn !== '__none__' && (
                          <span>
                            <Trans>Group: {chart.groupByColumn}</Trans>
                          </span>
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
                    <Trans>{newChart.xAxisColumn ? t`Edit` : t`Add`} Chart Configuration</Trans>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label={t`Chart Type`} className="space-y-2">
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
                          <SelectItem value="bar">
                            <Trans>Bar Chart</Trans>
                          </SelectItem>
                          <SelectItem value="line">
                            <Trans>Line Chart</Trans>
                          </SelectItem>
                          <SelectItem value="area">
                            <Trans>Area Chart</Trans>
                          </SelectItem>
                          <SelectItem value="pie">
                            <Trans>Pie Chart</Trans>
                          </SelectItem>
                          <SelectItem value="scatter">
                            <Trans>Scatter Plot</Trans>
                          </SelectItem>
                          <SelectItem value="table">
                            <Trans>Table</Trans>
                          </SelectItem>
                          <SelectItem value="stat">
                            <Trans>Stat</Trans>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label={t`Title (Optional)`} className="space-y-2">
                      <Input
                        value={newChart.title}
                        onChange={(e) =>
                          setNewChart((prev) => ({ ...prev, title: e.target.value }))
                        }
                        placeholder={t`Chart title...`}
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
                          placeholder={t`Select column`}
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
                        placeholder={t`Select column`}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {!['pie', 'stat'].includes(newChart.chartType) && (
                      <Field label={t`Group By`} className="space-y-2">
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
                      label={t`Aggregate Function`}
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
                          <SelectItem value="SUM">
                            <Trans>Sum</Trans>
                          </SelectItem>
                          <SelectItem value="COUNT">
                            <Trans>Count</Trans>
                          </SelectItem>
                          <SelectItem value="AVG">
                            <Trans>Average</Trans>
                          </SelectItem>
                          <SelectItem value="MAX">
                            <Trans>Maximum</Trans>
                          </SelectItem>
                          <SelectItem value="MIN">
                            <Trans>Minimum</Trans>
                          </SelectItem>
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
                      <Trans>Cancel</Trans>
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleAddChart}
                      disabled={!hasRequiredColumns}
                      className="w-full sm:w-auto"
                    >
                      <Trans>{hasRequiredColumns ? t`Update` : t`Add`} Chart</Trans>
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
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={() => void handleSave(false)}
            disabled={!reportName.trim() || isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? t`Saving...` : mode === 'create' ? t`Save` : t`Update`}
          </Button>
          <Button
            onClick={() => void handleSave(true)}
            disabled={!reportName.trim() || isSaving || charts.length === 0}
            className="w-full sm:w-auto"
            variant="secondary"
          >
            {isSaving ? t`Saving...` : mode === 'create' ? t`Save & Pin` : t`Update & Pin`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
