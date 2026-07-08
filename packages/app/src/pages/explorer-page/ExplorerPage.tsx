import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@shared/ui/sheet';
import { Database, Play, Copy, Save, BookOpen, Plus, Menu } from 'lucide-react';
import { SaveReportDialog } from '@features/reports/ui/SaveReportDialog';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useCustomDashboards,
  useAddDashboardWidget,
  useCreateCustomDashboard,
} from '@features/custom-dashboards/api/useCustomDashboards';
import { PinChartDialog } from '@pages/custom-dashboards/components/PinChartDialog';
import { toast } from 'sonner';
import type { UnifiedReport } from '@budgero/core/browser';

import { useExplorerState } from './hooks/useExplorerState';
import { SQLEditor, SchemaSidebar, ResultsTable, ReportsPanel, ChartsPanel } from './components';
import { COMMON_QUERIES } from './sql-utils';

export default function ExplorerPage() {
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const location = useLocation();
  const navigate = useNavigate();
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinReport, setPinReport] = useState<UnifiedReport | null>(null);

  const dashboardsQuery = useCustomDashboards(budgetId);
  const dashboards = dashboardsQuery.data ?? [];
  const addWidgetMutation = useAddDashboardWidget();
  const createDashboardMutation = useCreateCustomDashboard();

  const {
    sqlQuery,
    queryResult,
    isExecuting,
    error,
    tableSchema,
    expandedTables,
    sidebarOpen,
    showReportsDialog,
    showSaveReportDialog,
    editingReport,
    selectedChartConfig,
    savedReports,
    editorTheme,
    editorModules,
    extensions,

    setSqlQuery,
    setSidebarOpen,
    setShowReportsDialog,
    setShowSaveReportDialog,
    setEditingReport,
    setSelectedChartConfig,

    executeQuery,
    toggleTable,
    insertTableName,
    insertColumnName,
    formatSQL,
    copyResultsAsCSV,
    handleSaveReport,
    handleLoadReport,
    handleEditReport,
    handleDeleteReport,
    handleCreateReport,
    handleNewReport,
  } = useExplorerState();

  useEffect(() => {
    const routeState = location.state as { editReportId?: string; openSaveDialog?: boolean } | null;
    if (!routeState?.editReportId) return;

    const report = savedReports.find((item) => item.id === routeState.editReportId);
    if (!report) return;

    setSqlQuery(report.query);
    setEditingReport(report);
    setSelectedChartConfig(report.charts?.[0] ?? null);
    void executeQuery(report.query);

    if (routeState.openSaveDialog) {
      setShowSaveReportDialog(true);
    }

    void navigate(location.pathname, { replace: true, state: null });
  }, [
    location.pathname,
    location.state,
    navigate,
    savedReports,
    setSqlQuery,
    setEditingReport,
    setSelectedChartConfig,
    executeQuery,
    setShowSaveReportDialog,
  ]);

  const handleOpenPinDialog = (report: UnifiedReport) => {
    setPinReport(report);
    setPinDialogOpen(true);
  };

  const handlePinChart = async ({
    dashboardId,
    reportId,
    chartId,
  }: {
    dashboardId: string;
    reportId: string;
    chartId: string;
  }) => {
    await addWidgetMutation.mutateAsync({ dashboardId, reportId, chartId });
    toast.success('Chart pinned to dashboard');
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden w-80 flex-shrink-0 min-h-0 flex-col border-r bg-muted/10 lg:flex">
        <SchemaSidebar
          tableSchema={tableSchema}
          expandedTables={expandedTables}
          onToggleTable={toggleTable}
          onInsertTableName={insertTableName}
          onInsertColumnName={insertColumnName}
        />
      </div>

      {/* Mobile Schema Sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="flex h-full w-80 min-h-0 flex-col p-0">
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              Database Schema
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <SchemaSidebar
              tableSchema={tableSchema}
              expandedTables={expandedTables}
              onToggleTable={toggleTable}
              onInsertTableName={insertTableName}
              onInsertColumnName={insertColumnName}
              onCloseSidebar={() => setSidebarOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>

            <div className="flex-1">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Database className="h-5 w-5" />
                SQL Query Editor
              </h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                Click on tables and columns in the sidebar to insert them into your query
              </p>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-auto">
          <div className="p-2 sm:p-4 space-y-3 sm:space-y-4">
            {/* Common Queries */}
            <div className="flex flex-wrap gap-1 sm:gap-2 overflow-x-auto pb-2">
              {COMMON_QUERIES.map((query, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  onClick={() => setSqlQuery(query.query)}
                  className="whitespace-nowrap text-xs"
                >
                  {query.name}
                </Button>
              ))}
            </div>

            {/* SQL Editor */}
            <div className="space-y-2">
              <div className="flex flex-col gap-2">
                {/* Caption, not a <label>: the CodeMirror editor is not a labelable control. */}
                <span className="text-sm font-medium">SQL Query</span>
                <div className="flex flex-wrap gap-1 sm:gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowReportsDialog(true)}
                    size="sm"
                    className="text-xs"
                  >
                    <BookOpen className="h-3 w-3" />
                    <span className="hidden sm:inline ml-1">Reports</span>
                  </Button>
                  {editingReport && (
                    <Button
                      variant="outline"
                      onClick={handleNewReport}
                      size="sm"
                      disabled={!sqlQuery.trim()}
                      className="text-xs"
                    >
                      <Plus className="h-3 w-3" />
                      <span className="hidden sm:inline ml-1">New</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={handleCreateReport}
                    size="sm"
                    disabled={!sqlQuery.trim()}
                    className="text-xs"
                  >
                    <Save className="h-3 w-3" />
                    <span className="hidden sm:inline ml-1">
                      {editingReport ? 'Update' : 'Save'}
                    </span>
                  </Button>
                  <Button
                    onClick={() => executeQuery()}
                    disabled={isExecuting}
                    size="sm"
                    className="text-xs"
                  >
                    <Play className="h-3 w-3" />
                    <span className="hidden sm:inline ml-1">
                      {isExecuting ? 'Running...' : 'Run'}
                    </span>
                  </Button>
                  {queryResult && (
                    <Button
                      variant="outline"
                      onClick={copyResultsAsCSV}
                      size="sm"
                      className="text-xs"
                    >
                      <Copy className="h-3 w-3" />
                      <span className="hidden sm:inline ml-1">CSV</span>
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Button variant="outline" size="sm" onClick={formatSQL} className="text-xs">
                  Format SQL
                </Button>
                <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
                  <SQLEditor
                    value={sqlQuery}
                    onChange={setSqlQuery}
                    extensions={extensions}
                    theme={editorTheme}
                    onRun={() => executeQuery()}
                    editorModules={editorModules}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Results and Charts Area */}
          <div className="flex-1">
            <div className="p-2 sm:p-4 space-y-3 sm:space-y-4 pb-20 sm:pb-4">
              {error && (
                <Card className="border-destructive">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-destructive mb-2">Query Error</h3>
                    <pre className="text-xs text-destructive bg-destructive/10 p-3 rounded overflow-auto">
                      {error}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {queryResult && <ResultsTable result={queryResult} />}

              {/* Chart Visualizations */}
              {editingReport?.charts && editingReport.charts.length > 0 && queryResult && (
                <ChartsPanel
                  queryResult={queryResult}
                  charts={editingReport.charts}
                  selectedChartConfig={selectedChartConfig}
                  onSelectChart={setSelectedChartConfig}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Unified Save Report Dialog */}
      <SaveReportDialog
        open={showSaveReportDialog}
        onOpenChange={setShowSaveReportDialog}
        sqlQuery={sqlQuery}
        queryResult={queryResult}
        onSave={handleSaveReport}
        onSaveAndPin={handleOpenPinDialog}
        initialData={
          editingReport
            ? {
                name: editingReport.name,
                description: editingReport.description,
                charts: editingReport.charts || [],
              }
            : undefined
        }
        mode={editingReport ? 'edit' : 'create'}
      />

      {/* Saved Reports Dialog */}
      <ReportsPanel
        open={showReportsDialog}
        onOpenChange={setShowReportsDialog}
        savedReports={savedReports}
        onLoadReport={handleLoadReport}
        onEditReport={handleEditReport}
        onDeleteReport={handleDeleteReport}
        onPinChart={handleOpenPinDialog}
      />

      <PinChartDialog
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        reports={savedReports}
        dashboards={dashboards}
        defaultReportId={pinReport?.id}
        onCreateDashboard={async () => {
          await createDashboardMutation.mutateAsync({
            budgetId,
            name: 'My Dashboard',
          });
          await dashboardsQuery.refetch();
        }}
        onPin={handlePinChart}
      />
    </div>
  );
}
