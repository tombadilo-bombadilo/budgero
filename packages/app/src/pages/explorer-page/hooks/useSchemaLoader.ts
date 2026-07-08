import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeReportQuery } from '@shared/lib/sql/report-query-executor';
import { MAX_ROWS } from '../sql-utils';
import type { SqlDatabase, SqliteColumnInfo, TableInfo } from '../types';

/** Loads the DuckDB table/view schema on mount and tracks sidebar expand/collapse state. */
export function useSchemaLoader() {
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
      const viewsResult = await executeReportQuery(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = 'main' AND table_type = 'VIEW'
         ORDER BY table_name`,
        db,
        { maxRows: MAX_ROWS }
      );

      for (const row of viewsResult.rows) {
        const viewName = String(row[0] ?? '').trim();
        if (!viewName) continue;
        const viewNameKey = viewName.toLowerCase();
        if (knownNames.has(viewNameKey)) continue;

        const safeViewNameLiteral = viewName.replace(/'/g, "''");
        const safeViewNameIdentifier = `"${viewName.replace(/"/g, '""')}"`;

        const columnsResult = await executeReportQuery(
          `SELECT
             column_name AS name,
             data_type AS type,
             is_nullable AS is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'main'
             AND table_name = '${safeViewNameLiteral}'
           ORDER BY ordinal_position`,
          db,
          { maxRows: MAX_ROWS }
        );

        let viewRowCount = 0;
        try {
          const countResult = await executeReportQuery(
            `SELECT COUNT(*) AS count FROM ${safeViewNameIdentifier}`,
            db,
            { maxRows: 1 }
          );
          const rawCount = countResult.rows[0]?.[0];
          const parsedCount = Number(rawCount ?? 0);
          viewRowCount = Number.isFinite(parsedCount) ? parsedCount : 0;
        } catch {
          viewRowCount = 0;
        }

        schema.push({
          name: viewName,
          objectType: 'view',
          columns: columnsResult.rows
            .map((columnRow) => {
              const name = String(columnRow[0] ?? '').trim();
              if (!name) return null;
              return {
                name,
                type: String(columnRow[1] ?? 'VARCHAR'),
                nullable: String(columnRow[2] ?? 'YES').toUpperCase() === 'YES',
                primaryKey: false,
              };
            })
            .filter((column): column is TableInfo['columns'][number] => column !== null),
          rowCount: viewRowCount,
        });
        knownNames.add(viewNameKey);
      }

      setTableSchema(schema);
    } catch {
      toast.error('Schema Load Failed', {
        description: 'Failed to load database schema',
      });
    }
  }, [runtime]);

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
