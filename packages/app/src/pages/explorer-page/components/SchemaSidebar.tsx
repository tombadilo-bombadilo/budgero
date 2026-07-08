import { memo, useMemo, useState } from 'react';
import { Badge } from '@shared/ui/badge';
import { Input } from '@shared/ui/input';
import { ScrollArea } from '@shared/ui/scroll-area';
import { buttonizeProps } from '@shared/lib/a11y';
import {
  Database,
  TableIcon,
  ChevronRight,
  ChevronDown,
  Columns,
  Search,
  Eye,
  BarChart3,
} from 'lucide-react';
import type { TableInfo } from '../types';

export interface SchemaSidebarProps {
  tableSchema: TableInfo[];
  expandedTables: Set<string>;
  onToggleTable: (tableName: string) => void;
  onInsertTableName: (tableName: string) => void;
  onInsertColumnName: (tableName: string, columnName: string) => void;
  onCloseSidebar?: () => void;
}

export const SchemaSidebar = memo(
  ({
    tableSchema,
    expandedTables,
    onToggleTable,
    onInsertTableName,
    onInsertColumnName,
    onCloseSidebar,
  }: SchemaSidebarProps) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredSchema = useMemo(() => {
      const normalizedSearchTerm = searchTerm.trim().toLowerCase();
      if (!normalizedSearchTerm) return tableSchema;

      return tableSchema
        .map((table) => {
          const tableNameMatches = table.name.toLowerCase().includes(normalizedSearchTerm);
          const matchingColumns = table.columns.filter(
            (column) =>
              column.name.toLowerCase().includes(normalizedSearchTerm) ||
              column.type.toLowerCase().includes(normalizedSearchTerm)
          );

          if (!tableNameMatches && matchingColumns.length === 0) {
            return null;
          }

          return {
            ...table,
            columns: tableNameMatches ? table.columns : matchingColumns,
          };
        })
        .filter((table): table is TableInfo => table !== null);
    }, [tableSchema, searchTerm]);

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="p-4 border-b space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Database className="h-4 w-4" />
            Database Schema
          </h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search tables, views, columns..."
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2 space-y-1">
            {filteredSchema.map((table) => (
              <div key={table.name} className="space-y-1">
                {/* Table Header */}
                <div
                  className="flex items-center gap-1 px-2 py-1 rounded text-sm cursor-pointer hover:bg-muted/50"
                  {...buttonizeProps(() => onToggleTable(table.name))}
                  aria-expanded={expandedTables.has(table.name)}
                >
                  {expandedTables.has(table.name) ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {table.name.toLowerCase() === 'transactions_analytics' ? (
                    <BarChart3 className="h-3 w-3 text-amber-600" />
                  ) : table.objectType === 'view' ? (
                    <Eye className="h-3 w-3 text-violet-600" />
                  ) : (
                    <TableIcon className="h-3 w-3 text-blue-600" />
                  )}
                  <span
                    className="font-mono text-xs font-medium cursor-pointer hover:text-blue-600"
                    {...buttonizeProps((e) => {
                      e.stopPropagation();
                      onInsertTableName(table.name);
                      onCloseSidebar?.();
                    })}
                  >
                    {table.name}
                  </span>
                  {table.name.toLowerCase() === 'transactions_analytics' ? (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 uppercase">
                      Analytics
                    </Badge>
                  ) : table.objectType === 'view' ? (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 uppercase">
                      View
                    </Badge>
                  ) : null}
                  <Badge variant="secondary" className="ml-auto text-[10px] px-1">
                    {table.rowCount}
                  </Badge>
                </div>

                {/* Columns */}
                {expandedTables.has(table.name) && (
                  <div className="ml-4 space-y-0.5">
                    {table.columns.map((column) => (
                      <div
                        key={column.name}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer hover:bg-muted/30"
                        {...buttonizeProps(() => {
                          onInsertColumnName(table.name, column.name);
                          onCloseSidebar?.();
                        })}
                      >
                        <Columns className="h-3 w-3 text-gray-500" />
                        <span className="font-mono">{column.name}</span>
                        <span className="text-muted-foreground ml-auto">{column.type}</span>
                        {column.primaryKey && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0">
                            PK
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {filteredSchema.length === 0 && (
              <div className="px-2 py-4 text-xs text-muted-foreground">
                No matching schema items.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }
);

SchemaSidebar.displayName = 'SchemaSidebar';
