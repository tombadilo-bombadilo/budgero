import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useState, useCallback, useRef, useMemo } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import type { Extension } from '@codemirror/state';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeReportQuery } from '@shared/lib/sql/report-query-executor';
import { getErrorMessage } from '@shared/lib/errors';
import { useSqlEditorModules } from '@shared/hooks/useSqlEditorModules';
import type { QueryResult, SqlDatabase } from '../types';
import { isSelectQuery, formatSQL as formatSQLUtil, resultsToCSV, MAX_ROWS } from '../sql-utils';
import { useSchemaLoader } from './useSchemaLoader';
import { useReportActions } from './useReportActions';

const DEFAULT_QUERY = `
SELECT table_name AS name
FROM information_schema.tables
WHERE table_schema = 'main' AND table_type IN ('BASE TABLE', 'VIEW')
ORDER BY table_name;
`;

const DUCKDB_EXTRA_KEYWORDS = msg`qualify pivot unpivot sample using asof lateral recursive`;
const DUCKDB_EXTRA_BUILTINS = msg`date_trunc time_bucket strftime epoch list array_agg string_agg approx_count_distinct arg_max arg_min`;
const DUCKDB_EXTRA_TYPES = msg`utinyint usmallint uinteger ubigint hugeint uhugeint`;

export function useExplorerState() {
  const { t } = useLingui();

  const [sqlQuery, setSqlQuery] = useState(DEFAULT_QUERY);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { theme, resolvedTheme } = useTheme();
  const editorTheme: 'light' | 'dark' =
    theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark') ? 'dark' : 'light';

  const runtime = useRuntime();
  const editorModules = useSqlEditorModules();

  const { tableSchema, expandedTables, toggleTable } = useSchemaLoader();

  const sqlQueryRef = useRef(sqlQuery);
  sqlQueryRef.current = sqlQuery;

  const executeQuery = useCallback(
    async (overrideQuery?: string) => {
      const queryToRun = overrideQuery ?? sqlQueryRef.current;
      if (!queryToRun.trim()) {
        toast.error(t`No Query`, {
          description: t`Please enter a SQL query`,
        });
        return;
      }

      setIsExecuting(true);
      setError(null);

      try {
        const db = runtime.getDatabase() as SqlDatabase | null;
        if (!db) throw new Error('Database not available');

        // Read-only by design: every run goes through the DuckDB report snapshot,
        // never the live SQLite database (writes here would bypass the mutation log).
        if (!isSelectQuery(queryToRun)) {
          throw new Error(
            t`Only read-only queries can run here (SELECT, WITH, EXPLAIN, DESCRIBE, SHOW, PRAGMA).`
          );
        }
        const result = await executeReportQuery(queryToRun, db, { maxRows: MAX_ROWS });
        setQueryResult(result);
        if (result.rowCount > result.rows.length && result.rows.length === MAX_ROWS) {
          toast.warning(t`Results Limited`, {
            description: t`Showing first ${MAX_ROWS.toLocaleString()} rows. Add a LIMIT clause for better performance.`,
          });
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error, t`Failed to execute query`);
        setError(errorMessage);
        toast.error(t`Query Failed`, {
          description: errorMessage,
        });
      } finally {
        setIsExecuting(false);
      }
    },
    [runtime, t]
  );

  const insertTableName = useCallback((tableName: string) => {
    setSqlQuery((prev) => prev + tableName);
  }, []);

  const insertColumnName = useCallback((tableName: string, columnName: string) => {
    setSqlQuery((prev) => `${prev}${tableName}.${columnName}`);
  }, []);

  const formatSQL = useCallback(() => {
    setSqlQuery((prev) => formatSQLUtil(prev));
  }, []);

  const copyResultsAsCSV = useCallback(() => {
    if (!queryResult) return;

    const csvContent = resultsToCSV(queryResult.columns, queryResult.rows);

    navigator.clipboard
      .writeText(csvContent)
      .then(() => {
        const rowCount = queryResult.rows.length;
        const columnCount = queryResult.columns.length;
        toast.success(t`CSV Copied!`, {
          description: plural(rowCount, {
            one: `# row × ${columnCount} columns copied to the clipboard`,
            other: `# rows × ${columnCount} columns copied to the clipboard`,
          }),
        });
      })
      .catch((error) => {
        console.error('Failed to copy to clipboard:', error);
        toast.error(t`Copy Failed`, {
          description: t`Failed to copy to clipboard. Please try again.`,
        });
      });
  }, [queryResult, t]);

  const {
    showSaveReportDialog,
    editingReport,
    selectedChartConfig,
    setShowSaveReportDialog,
    setEditingReport,
    setSelectedChartConfig,
    handleSaveReport,
    handleCreateReport,
  } = useReportActions({
    sqlQuery,
    setSqlQuery,
    executeQuery,
  });

  const extensions = useMemo((): Extension[] => {
    if (!editorModules) return [];

    const runExec = () => {
      void executeQuery();
      return true;
    };

    const postgresSpec = editorModules.PostgreSQL.spec;
    const duckDbDialect = editorModules.SQLDialect.define({
      ...postgresSpec,
      keywords: `${postgresSpec.keywords ?? ''} ${DUCKDB_EXTRA_KEYWORDS}`.trim(),
      builtin: `${postgresSpec.builtin ?? ''} ${DUCKDB_EXTRA_BUILTINS}`.trim(),
      types: `${postgresSpec.types ?? ''} ${DUCKDB_EXTRA_TYPES}`.trim(),
    });

    const schema: Record<string, Record<string, string[]>> = { main: {} };
    tableSchema.forEach((table) => {
      schema.main[table.name] = table.columns.map((column) => column.name);
    });

    const extensionList: Extension[] = [
      editorModules.keymap.of([
        { key: 'Mod-Enter', run: runExec, preventDefault: true },
        { key: 'Ctrl-Enter', run: runExec, preventDefault: true },
        { key: 'Cmd-Enter', run: runExec, preventDefault: true },
        { key: 'Shift-Enter', run: runExec, preventDefault: true },
      ]),
      editorModules.sql({
        dialect: duckDbDialect,
        schema,
        defaultSchema: 'main',
        upperCaseKeywords: true,
      }),
    ];

    return extensionList;
  }, [tableSchema, editorModules, executeQuery]);

  return {
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
  };
}
