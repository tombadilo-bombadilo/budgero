import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  Database,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  Play,
  Save,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { UnifiedReport } from '@budgero/core/browser';
import { useLeaveGuard } from '@shared/hooks/useLeaveGuard';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@shared/ui/sheet';
import { SaveReportDialog } from '@features/reports/ui/SaveReportDialog';
import { stripQuestionHeader } from '@features/reports/lib/question';
import { QuestionHeader } from '@pages/reports/question/QuestionHeader';
import { useDeleteQuestion } from '@pages/reports/question/useDeleteQuestion';
import { useOpenSavedQuestion } from '@pages/reports/question/useOpenSavedQuestion';
import { usePinToDashboard } from '@pages/reports/question/usePinToDashboard';
import { SqlChartVisualization } from '@features/reports/ui/notebook/SqlChartVisualization';
import { chartChoiceLabel } from '@pages/custom-dashboards/components/question-choices';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { SQLEditor, SchemaSidebar, ResultsTable } from './components';
import { useExplorerState } from './hooks/useExplorerState';
import { COMMON_QUERIES } from './sql-utils';

interface SqlQuestionViewProps {
  budgetId: number;
  /**
   * The saved report this editor saves to: a SQL report, or a notebook
   * question being converted (saving then drops its notebook header).
   */
  report: UnifiedReport | null;
  /** SQL to start from (a converted question); defaults to the report's query. */
  initialSql?: string;
  openSaveDialog?: boolean;
  /** Open "Add to dashboard" on arrival (the question was just saved with it). */
  openPinDialog?: boolean;
  /** Leave a "Convert to SQL" unsaved and go back to the notebook question. */
  onBackToNotebook?: () => void;
}

/** SQL (advanced) editor for a question. Runs read-only queries only. */
export function SqlQuestionView({
  budgetId,
  report,
  initialSql,
  openSaveDialog = false,
  openPinDialog = false,
  onBackToNotebook,
}: SqlQuestionViewProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const pin = usePinToDashboard(budgetId);
  const deletion = useDeleteQuestion(() => void navigate('/reports'));
  const opener = useOpenSavedQuestion();
  const pinOnArrival = useRef(openPinDialog);
  useEffect(() => {
    if (!pinOnArrival.current || !report) return;
    pinOnArrival.current = false;
    pin.open(report);
  }, [pin, report]);
  const {
    sqlQuery,
    queryResult,
    isExecuting,
    error,
    tableSchema,
    expandedTables,
    sidebarOpen,
    showSaveReportDialog,
    editingReport,
    selectedChartConfig,
    editorTheme,
    editorModules,
    extensions,
    setSqlQuery,
    setSidebarOpen,
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
    handleCreateReport,
  } = useExplorerState();

  // Load the starting SQL once.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const start = initialSql ?? (report ? stripQuestionHeader(report.query) : null);
    // Deferred: opening a report updates several pieces of page state.
    void Promise.resolve().then(() => {
      if (report) {
        setEditingReport(report);
        setSelectedChartConfig(report.charts?.[0] ?? null);
      }
      if (start) {
        setSqlQuery(start);
        void executeQuery(start);
      }
      if (openSaveDialog && report) setShowSaveReportDialog(true);
    });
  }, [
    initialSql,
    report,
    openSaveDialog,
    setEditingReport,
    setSelectedChartConfig,
    setSqlQuery,
    executeQuery,
    setShowSaveReportDialog,
  ]);

  const converting = initialSql !== undefined && report !== null;
  // Unsaved: a conversion not saved yet, or SQL edited away from what was opened.
  const [startSql, setStartSql] = useState(
    () => initialSql ?? (report ? stripQuestionHeader(report.query) : sqlQuery)
  );
  const dirty = initialSql !== undefined || sqlQuery.trim() !== startSql.trim();
  // A notebook header this version could not read (e.g. saved by a newer app):
  // saving with the SQL unchanged keeps it, so the notebook version survives.
  const unreadHeader =
    report && !converting && stripQuestionHeader(report.query) !== report.query
      ? report.query.replace(/^\s+/, '').split('\n', 1)[0]
      : null;
  const keepsHeader = unreadHeader !== null && sqlQuery.trim() === startSql.trim();
  useLeaveGuard(dirty && !showSaveReportDialog);
  const title = editingReport?.name ?? t`New SQL question`;

  const schemaSidebar = (onClose?: () => void) => (
    <SchemaSidebar
      tableSchema={tableSchema}
      expandedTables={expandedTables}
      onToggleTable={toggleTable}
      onInsertTableName={insertTableName}
      onInsertColumnName={insertColumnName}
      onCloseSidebar={onClose}
    />
  );

  return (
    <div className="flex w-full">
      <div className="hidden w-80 min-h-0 flex-shrink-0 flex-col border-r bg-muted/10 lg:flex">
        {schemaSidebar()}
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="flex h-full w-80 min-h-0 flex-col p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4" aria-hidden />
              <Trans>Database Schema</Trans>
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {schemaSidebar(() => setSidebarOpen(false))}
          </div>
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1 space-y-4 p-4 pb-24 sm:p-6 md:pb-6">
        <QuestionHeader
          title={title}
          subtitle={
            converting
              ? t`Converted to SQL. Saving replaces the notebook version.`
              : unreadHeader !== null
                ? keepsHeader
                  ? t`Made with a newer notebook; shown as SQL. Saving keeps the notebook version while the SQL is unchanged.`
                  : t`Made with a newer notebook. Saving these SQL changes replaces the notebook version.`
                : t`SQL (advanced) · read-only queries`
          }
        >
          {onBackToNotebook && (
            <Button variant="outline" size="sm" onClick={onBackToNotebook}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <Trans>Back to the notebook</Trans>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t`Database Schema`}
          >
            <Menu className="h-4 w-4" aria-hidden />
          </Button>
          {editingReport && !converting && (
            <Button variant="outline" size="sm" onClick={() => pin.open(editingReport)}>
              <LayoutGrid className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">
                <Trans>Add to dashboard</Trans>
              </span>
            </Button>
          )}
          <Button size="sm" onClick={handleCreateReport} disabled={!sqlQuery.trim()}>
            <Save className="h-4 w-4" aria-hidden />
            {editingReport ? t`Save` : t`Save question`}
          </Button>
          {editingReport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t`More actions`}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => deletion.ask(editingReport)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  <Trans>Delete question</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </QuestionHeader>

        <div className="flex flex-wrap gap-1 sm:gap-2">
          {COMMON_QUERIES.map((item) => (
            <Button
              key={item.query}
              variant="outline"
              size="sm"
              onClick={() => setSqlQuery(item.query)}
              className="whitespace-nowrap text-xs"
            >
              {t(item.name)}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Caption, not a <label>: the CodeMirror editor is not a labelable control. */}
            <span className="mr-auto text-sm font-medium">
              <Trans>SQL Query</Trans>
            </span>
            <Button variant="outline" size="sm" onClick={formatSQL} className="text-xs">
              <Trans>Format SQL</Trans>
            </Button>
            {queryResult && (
              <Button variant="outline" onClick={copyResultsAsCSV} size="sm" className="text-xs">
                <Copy className="h-3 w-3" aria-hidden />
                CSV
              </Button>
            )}
            <Button
              onClick={() => executeQuery()}
              disabled={isExecuting}
              size="sm"
              className="text-xs"
            >
              <Play className="h-3 w-3" aria-hidden />
              {isExecuting ? t`Running...` : t`Run`}
            </Button>
          </div>
          <div className="overflow-hidden rounded-md border">
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

        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4">
              <h3 className="mb-2 font-semibold text-destructive">
                <Trans>Query Error</Trans>
              </h3>
              <pre className="overflow-auto rounded bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </pre>
            </CardContent>
          </Card>
        )}

        {queryResult && <ResultsTable result={queryResult} />}

        {editingReport?.charts && editingReport.charts.length > 0 && queryResult && (
          <section
            aria-label={t`Chart`}
            className="space-y-3 rounded-lg border bg-card p-3 text-card-foreground sm:p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              {editingReport.charts.length > 1 && (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={selectedChartConfig?.id ?? editingReport.charts[0].id}
                  onValueChange={(id) => {
                    const next = editingReport.charts.find((chart) => chart.id === id);
                    if (next) setSelectedChartConfig(next);
                  }}
                  aria-label={t`Charts of this question`}
                  className="flex-wrap"
                >
                  {editingReport.charts.map((chart) => (
                    <ToggleGroupItem
                      key={chart.id}
                      value={chart.id}
                      className="w-auto flex-none whitespace-nowrap px-2.5"
                    >
                      {chartChoiceLabel(chart)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-8"
                onClick={() => setShowSaveReportDialog(true)}
                title={t`Chart type, columns and aggregate are set with the question`}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                <Trans>Edit chart</Trans>
              </Button>
            </div>
            <SqlChartVisualization
              result={queryResult}
              // The saved version of the picked chart (it may have just been edited).
              chart={
                editingReport.charts.find((chart) => chart.id === selectedChartConfig?.id) ??
                editingReport.charts[0]
              }
              exportName={editingReport.name}
            />
          </section>
        )}
      </div>

      <SaveReportDialog
        open={showSaveReportDialog}
        onOpenChange={setShowSaveReportDialog}
        sqlQuery={sqlQuery}
        queryResult={queryResult}
        onSave={async (data) => {
          const saved = await handleSaveReport(
            keepsHeader && unreadHeader
              ? { ...data, query: `${unreadHeader}\n${data.query}` }
              : data
          );
          setStartSql(data.query);
          // A new (or converted) question moves to its own page.
          if (!report || converting) opener.open(saved);
          return saved;
        }}
        onSaveAndPin={!report || converting ? opener.openAndPin : pin.open}
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
      {pin.dialog}
      {deletion.dialog}
    </div>
  );
}
