import { memo } from 'react';
import { Badge } from '@shared/ui/badge';
import { ScrollArea } from '@shared/ui/scroll-area';
import { Database, TableIcon, ChevronRight, ChevronDown } from 'lucide-react';
import type { SchemaSidebarProps } from './types';

export const SchemaSidebar = memo(
  ({ tableSchema, expandedTables, onToggleTable, onInsertColumnName }: SchemaSidebarProps) => (
    <div className="flex flex-col h-full bg-muted/20">
      <div className="p-4 border-b border-border/60">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Database className="h-4 w-4 text-purple-600" />
          Database Schema
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {tableSchema.length} tables - Click to insert
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {tableSchema.map((table) => {
            const isExpanded = expandedTables.has(table.name);
            return (
              <div key={table.name} className="border border-border/50 rounded-md bg-background">
                <button
                  type="button"
                  onClick={() => onToggleTable(table.name)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors rounded-t-md"
                >
                  <span className="flex items-center gap-2">
                    <TableIcon className="h-4 w-4 text-muted-foreground" />
                    {table.name}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{table.rowCount.toLocaleString()} rows</Badge>
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-3 py-2 space-y-1 border-t border-border/30">
                    {table.columns.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No column metadata</p>
                    ) : (
                      table.columns.map((column) => (
                        <button
                          type="button"
                          key={`${table.name}.${column.name}`}
                          onClick={() => onInsertColumnName(table.name, column.name)}
                          className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted/50 transition-colors flex items-center justify-between group"
                        >
                          <span>
                            <span className="font-mono text-[11px]">{column.name}</span>
                            <span className="text-muted-foreground ml-2 uppercase">
                              {column.type || 'TEXT'}
                            </span>
                          </span>
                          {column.primaryKey && (
                            <Badge variant="secondary" className="text-[10px]">
                              PK
                            </Badge>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  )
);

SchemaSidebar.displayName = 'SchemaSidebar';
