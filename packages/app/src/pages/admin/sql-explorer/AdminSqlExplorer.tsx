import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Sheet, SheetContent } from '@shared/ui/sheet';
import { Columns, Menu } from 'lucide-react';
import { useSqlExplorerState } from './useSqlExplorerState';
import { SchemaSidebar } from './SchemaSidebar';
import { QueryCard } from './QueryCard';
import { ResultsTable } from './ResultsTable';

export function AdminSqlExplorer() {
  const {
    sqlQuery,
    setSqlQuery,
    queryResult,
    isExecuting,
    error,
    tableSchema,
    expandedTables,
    sidebarOpen,
    setSidebarOpen,
    showErrorDialog,
    setShowErrorDialog,
    isDryRun,
    setIsDryRun,
    isDarkMode,
    editorModules,
    extensions,

    savedQueries,
    isLoadingSavedQueries,
    saveQueryName,
    setSaveQueryName,

    executeQuery,
    toggleTable,
    insertColumnName,
    copyResultsAsCSV,
    formatSQL,
    handleSaveQuery,
    handleLoadSavedQuery,
    handleDeleteSavedQuery,
  } = useSqlExplorerState();

  return (
    <div className="flex h-full">
      {/* Left sidebar - Schema Explorer */}
      <div className="hidden lg:flex w-80 border-r bg-background flex-col">
        <SchemaSidebar
          tableSchema={tableSchema}
          expandedTables={expandedTables}
          onToggleTable={toggleTable}
          onInsertColumnName={insertColumnName}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col h-full">
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Columns className="h-5 w-5 text-purple-600" />
              SQL Explorer
            </h1>
            <p className="text-sm text-muted-foreground">
              Run read-only analysis or maintenance queries against the primary server database.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open schema sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4 max-w-6xl mx-auto">
            <QueryCard
              sqlQuery={sqlQuery}
              setSqlQuery={setSqlQuery}
              isDryRun={isDryRun}
              setIsDryRun={setIsDryRun}
              isExecuting={isExecuting}
              queryResult={queryResult}
              executeQuery={executeQuery}
              copyResultsAsCSV={copyResultsAsCSV}
              formatSQL={formatSQL}
              extensions={extensions}
              isDarkMode={isDarkMode}
              editorModules={editorModules}
              savedQueries={savedQueries}
              isLoadingSavedQueries={isLoadingSavedQueries}
              saveQueryName={saveQueryName}
              setSaveQueryName={setSaveQueryName}
              onSaveQuery={handleSaveQuery}
              onLoadQuery={handleLoadSavedQuery}
              onDeleteQuery={handleDeleteSavedQuery}
            />

            {error && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-destructive">Query Error</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs font-mono whitespace-pre-wrap text-destructive">{error}</p>
                </CardContent>
              </Card>
            )}

            {queryResult && <ResultsTable result={queryResult} />}
          </div>
        </div>
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-80 sm:w-96 p-0">
          <SchemaSidebar
            tableSchema={tableSchema}
            expandedTables={expandedTables}
            onToggleTable={toggleTable}
            onInsertColumnName={insertColumnName}
          />
        </SheetContent>
      </Sheet>

      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Query Failed</DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => setShowErrorDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AdminSqlExplorer;
