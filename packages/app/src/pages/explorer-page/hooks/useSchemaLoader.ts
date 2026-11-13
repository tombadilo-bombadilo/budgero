import { useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeReportQuery } from '@shared/lib/sql/report-query-executor';
import { MAX_ROWS } from '../sql-utils';
import type { SqlDatabase, SqliteColumnInfo, TableInfo } from '../types';

/** Loads the DuckDB table/view schema on mount and tracks sidebar expand/collapse state. */
export function useSchemaLoader() {
  const { t } = useLingui();

  const runtime = useRuntime();
  const [tableSchema, setTableSchema] = useState<TableInfo[]>([]);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const loadSchema = useCallback(async () => {
    try {
      const db = runtime.getDatabase() as SqlDatabase | null;
      if (!db) return;

      const tablesStmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      const tables = tablesStmt.all();
      tablesStmt.finalize();

      const schema: TableInfo[] = [];

      for (const table of tables) {
        const columnsStmt = db.prepare(`PRAGMA table_info(${table.name})`);
        const columns = columnsStmt.all();
        columnsStmt.finalize();

        const countStmt = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`);
        const countResult = countStmt.get();
        countStmt.finalize();

        schema.push({
          name: table.name as string,
          objectType: 'table',
          columns: (columns as unknown as SqliteColumnInfo[]).map((col) => ({
            name: col.name,
            type: col.type,
            nullable: !col.notnull,
            primaryKey: !!col.pk,
          })),
          rowCount: (countResult as { count?: number })?.count ?? 0,
        });
      }

      const knownNames = new Set(schema.map((table) => table.name.toLowerCase()));
      // Analytics views, plus the reporting tables the app computes
      // (budget_months, scheduled_*), which exist only in DuckDB.
      const viewsResult = await executeReportQuery(
        `SELECT table_name AS name, table_type AS kind
         FROM information_schema.tables
         WHERE table_schema = 'main' AND table_type IN ('VIEW', 'BASE TABLE')
         ORDER BY table_name`,
        db,
        { maxRows: MAX_ROWS }
      );

      // All their columns in one query.
      const columnsResult = await executeReportQuery(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'main'
         ORDER BY table_name, ordinal_position`,
        db,
        { maxRows: MAX_ROWS }
      );
      const columnsByTable = new Map<string, TableInfo['columns']>();
      for (const [table, name, type, nullable] of columnsResult.rows) {
        const key = String(table ?? '');
        const list = columnsByTable.get(key) ?? [];
        list.push({
          name: String(name ?? ''),
          type: String(type ?? 'VARCHAR'),
          nullable: String(nullable ?? 'YES').toUpperCase() === 'YES',
          primaryKey: false,
        });
        columnsByTable.set(key, list);
      }

      for (const row of viewsResult.rows) {
        const viewName = String(row[0] ?? '').trim();
        if (!viewName) continue;
        const viewNameKey = viewName.toLowerCase();
        if (knownNames.has(viewNameKey)) continue;
        const isView = String(row[1] ?? '') === 'VIEW';

        // Views are counted; the computed reporting tables are not, since
        // counting them would compute them (and materialize scheduled
        // occurrences) just for opening the tab.
        let viewRowCount: number | null = null;
        if (isView) {
          try {
            const countResult = await executeReportQuery(
              `SELECT COUNT(*) AS count FROM "${viewName.replace(/"/g, '""')}"`,
              db,
              { maxRows: 1 }
            );
            const parsedCount = Number(countResult.rows[0]?.[0] ?? 0);
            viewRowCount = Number.isFinite(parsedCount) ? parsedCount : 0;
          } catch {
            viewRowCount = 0;
          }
        }

        schema.push({
          name: viewName,
          objectType: isView ? 'view' : 'table',
          columns: (columnsByTable.get(viewName) ?? []).filter((column) => column.name),
          rowCount: viewRowCount,
        });
        knownNames.add(viewNameKey);
      }

      setTableSchema(schema);
    } catch {
      toast.error(t`Schema Load Failed`, {
        description: t`Failed to load database schema`,
      });
    }
  }, [runtime, t]);

  // Load schema on mount
  useEffect(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    void loadSchema();
  }, [loadSchema]);

  const toggleTable = useCallback((tableName: string) => {
    setExpandedTables((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(tableName)) {
        newExpanded.delete(tableName);
      } else {
        newExpanded.add(tableName);
      }
      return newExpanded;
    });
  }, []);

  return { tableSchema, expandedTables, toggleTable };
}
