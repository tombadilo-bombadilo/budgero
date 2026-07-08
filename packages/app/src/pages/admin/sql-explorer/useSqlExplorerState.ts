import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Extension } from '@codemirror/state';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import { useSqlEditorModules } from '@shared/hooks/useSqlEditorModules';
import type { ApiError } from '@shared/hooks/useApiClient';
import type { QueryResult, SavedQueryItem, TableInfo } from './types';
import { DEFAULT_SQL_QUERY } from './constants';
import {
  isWriteQuery,
  convertToDryRunQuery,
  formatSQL as formatSQLUtil,
  convertResultsToCSV,
} from './sql-explorer.utils';

export function useSqlExplorerState() {
  const { theme, resolvedTheme } = useTheme();
  const {
    getDatabaseTables,
    getDatabaseTableData,
    runDatabaseQuery,
    getSavedQueries,
    saveQuery,
    deleteSavedQuery,
  } = useAdminApi();
  const editorModules = useSqlEditorModules();

  const isDarkMode = theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark');

  const [sqlQuery, setSqlQuery] = useState(DEFAULT_SQL_QUERY);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableSchema, setTableSchema] = useState<TableInfo[]>([]);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [_isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [isDryRun, setIsDryRun] = useState(true); // Default to safe mode!

  const [savedQueries, setSavedQueries] = useState<SavedQueryItem[]>([]);
  const [isLoadingSavedQueries, setIsLoadingSavedQueries] = useState(false);
  const [saveQueryName, setSaveQueryName] = useState('');

  const sqlQueryRef = useRef(sqlQuery);
  sqlQueryRef.current = sqlQuery;

  // Use refs for API functions to avoid dependency issues in useEffect
  const apiRef = useRef({ getDatabaseTables, getDatabaseTableData, getSavedQueries });
  apiRef.current = { getDatabaseTables, getDatabaseTableData, getSavedQueries };

  const hasLoadedRef = useRef(false);

  const loadSchema = useCallback(async () => {
    setIsLoadingSchema(true);
    try {
      const tables = await apiRef.current.getDatabaseTables();
      const schema: TableInfo[] = [];

      for (const table of tables) {
        let columns =
          table.columns?.map((col) => ({
            name: col.name,
            type: col.type,
            nullable: col.nullable,
            primaryKey: col.primaryKey,
          })) ?? [];

        let rowCount = table.rowCount ?? 0;

        if (columns.length === 0) {
          try {
            const details = await apiRef.current.getDatabaseTableData(table.name, { limit: 0 });
            columns = details.columns.map((col) => ({
              name: col.name,
              type: col.type,
              nullable: col.nullable,
              primaryKey: col.primaryKey,
            }));
            rowCount = details.totalCount;
          } catch (err) {
            console.error('Failed to load table schema', { table: table.name, err });
          }
        }

        schema.push({
          name: table.name,
          rowCount,
          columns,
        });
      }

      setTableSchema(schema.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      const errorMessage =
        (err as ApiError)?.message || 'Failed to load database schema from server';
      toast.error('Schema Load Failed', {
        description: errorMessage,
      });
    } finally {
      setIsLoadingSchema(false);
    }
  }, []);

  const loadSavedQueries = useCallback(async () => {
    setIsLoadingSavedQueries(true);
    try {
      const queries = await apiRef.current.getSavedQueries();
      setSavedQueries(queries);
    } catch (err) {
      console.error('Failed to load saved queries', err);
    } finally {
      setIsLoadingSavedQueries(false);
    }
  }, []);

  // Load schema and saved queries on mount only
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadSchema();
    void loadSavedQueries();
  }, [loadSchema, loadSavedQueries]);

  const handleSaveQuery = useCallback(
    async (name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        toast.error('Name required', {
          description: 'Please enter a name for this query.',
        });
        return;
      }
      const currentQuery = sqlQueryRef.current.trim();
      if (!currentQuery) {
        toast.error('No query', {
          description: 'Please enter a SQL query to save.',
        });
        return;
      }

      try {
        await saveQuery(trimmedName, currentQuery);
        toast.success('Query saved', { description: `Saved as "${trimmedName}"` });
        setSaveQueryName('');
        await loadSavedQueries();
      } catch (err) {
        console.error('Failed to save query', err);
        toast.error('Save failed', {
          description: 'Could not save the query.',
        });
      }
    },
    [saveQuery, loadSavedQueries]
  );

  const handleLoadSavedQuery = useCallback((query: SavedQueryItem) => {
    setSqlQuery(query.query);
    toast.success('Query loaded', { description: `Loaded "${query.name}"` });
  }, []);

  const handleDeleteSavedQuery = useCallback(
    async (name: string) => {
      try {
        await deleteSavedQuery(name);
        toast.success('Query deleted', { description: `Deleted "${name}"` });
        await loadSavedQueries();
      } catch (err) {
        console.error('Failed to delete query', err);
        toast.error('Delete failed', {
          description: 'Could not delete the query.',
        });
      }
    },
    [deleteSavedQuery, loadSavedQueries]
  );

  const executeQuery = useCallback(
    async (overrideQuery?: string) => {
      const queryToRun = (overrideQuery ?? sqlQueryRef.current).trim();
      if (!queryToRun) {
        toast.error('No Query', {
          description: 'Please enter a SQL query.',
        });
        return;
      }

      const isWrite = isWriteQuery(queryToRun);
      let finalQuery = queryToRun;

      if (isWrite && isDryRun) {
        finalQuery = convertToDryRunQuery(queryToRun);
      }

      setIsExecuting(true);
      setError(null);

      try {
        const response = await runDatabaseQuery(finalQuery);

        const result = {
          ...response,
          fetchedRows: response.rows.length,
          isDryRun: isWrite && isDryRun,
        };

        setQueryResult(result as QueryResult);

        if (isWrite && isDryRun) {
          toast.success('Dry Run Complete', {
            description: 'Showing what would be affected. No changes were made.',
          });
        } else if (isWrite && !isDryRun) {
          toast.success('Query Executed', {
            description: 'Changes have been applied to the database.',
          });
        }
      } catch (err) {
        const apiError = err as ApiError;
        const errorMessage = apiError?.message || 'Failed to execute query';
        setError(errorMessage);
        setShowErrorDialog(true);
        toast.error('Query Failed', {
          description: errorMessage,
        });
      } finally {
        setIsExecuting(false);
      }
    },
    [runDatabaseQuery, isDryRun]
  );

  const extensions = useMemo((): Extension[] => {
    if (!editorModules) return [];

    const runExec = () => {
      void executeQuery();
      return true;
    };

    const baseExtensions: Extension[] = [
      editorModules.keymap.of([
        { key: 'Mod-Enter', run: runExec, preventDefault: true },
        { key: 'Ctrl-Enter', run: runExec, preventDefault: true },
        { key: 'Cmd-Enter', run: runExec, preventDefault: true },
        { key: 'Shift-Enter', run: runExec, preventDefault: true },
      ]),
      editorModules.sql(),
    ];

    if (tableSchema.length > 0) {
      const completions: { label: string; type: string; info?: string }[] = [];

      tableSchema.forEach((table) => {
        completions.push({
          label: table.name,
          type: 'table',
          info: `Table with ${table.rowCount} rows`,
        });

        table.columns.forEach((column) => {
          completions.push({
            label: `${table.name}.${column.name}`,
            type: 'property',
            info: `${column.type}${column.primaryKey ? ' (PK)' : ''}`,
          });
          completions.push({
            label: column.name,
            type: 'property',
            info: `${table.name}.${column.name} (${column.type})`,
          });
        });
      });

      baseExtensions.push(
        editorModules.autocompletion({
          override: [
            (context) => {
              const word = context.matchBefore(/\w*/);
              if (!word) return null;
              const term = word.text.toLowerCase();
              return {
                from: word.from,
                options: completions.filter((c) => c.label.toLowerCase().includes(term)),
              };
            },
          ],
        })
      );
    }

    return baseExtensions;
  }, [tableSchema, executeQuery, editorModules]);

  const toggleTable = useCallback((tableName: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
      }
      return next;
    });
  }, []);

  const insertColumnName = useCallback((tableName: string, columnName: string) => {
    setSqlQuery((prev) => `${prev}${tableName}.${columnName}`);
  }, []);

  const copyResultsAsCSV = useCallback(() => {
    if (!queryResult || queryResult.columns.length === 0) return;

    const csvContent = convertResultsToCSV(queryResult);

    navigator.clipboard
      .writeText(csvContent)
      .then(() => {
        toast.success('CSV Copied', {
          description: `${queryResult.fetchedRows.toLocaleString()} rows x ${queryResult.columns.length} columns copied to clipboard`,
        });
      })
      .catch((err) => {
        console.error('Failed to copy CSV', err);
        toast.error('Copy Failed', {
          description: 'Failed to write to clipboard. Please try again.',
        });
      });
  }, [queryResult]);

  const formatSQL = useCallback(() => {
    setSqlQuery((prev) => formatSQLUtil(prev));
  }, []);

  return {
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
  };
}
