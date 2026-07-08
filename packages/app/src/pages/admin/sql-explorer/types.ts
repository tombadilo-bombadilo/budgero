import type { Extension } from '@codemirror/state';
import type { AdminQueryResult } from '@features/admin/model/admin-database';
import type { useSqlEditorModules } from '@shared/hooks/useSqlEditorModules';

export interface QueryResult extends AdminQueryResult {
  fetchedRows: number;
  isDryRun?: boolean;
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
  }[];
}

export interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  extensions: Extension[];
  isDark: boolean;
  onRun?: () => void;
  editorModules: ReturnType<typeof useSqlEditorModules>;
}

export interface ResultsTableProps {
  result: QueryResult;
}

export interface SchemaSidebarProps {
  tableSchema: TableInfo[];
  expandedTables: Set<string>;
  onToggleTable: (tableName: string) => void;
  onInsertColumnName: (tableName: string, columnName: string) => void;
}

export interface QueryCardProps {
  sqlQuery: string;
  setSqlQuery: (query: string) => void;
  isDryRun: boolean;
  setIsDryRun: (value: boolean) => void;
  isExecuting: boolean;
  queryResult: QueryResult | null;
  executeQuery: (overrideQuery?: string) => void;
  copyResultsAsCSV: () => void;
  formatSQL: () => void;
  extensions: Extension[];
  isDarkMode: boolean;
  editorModules: ReturnType<typeof useSqlEditorModules>;
  savedQueries: SavedQueryItem[];
  isLoadingSavedQueries: boolean;
  saveQueryName: string;
  setSaveQueryName: (name: string) => void;
  onSaveQuery: (name: string) => void;
  onLoadQuery: (query: SavedQueryItem) => void;
  onDeleteQuery: (name: string) => void;
}

export interface CommonQuery {
  name: string;
  query: string;
}

export interface SavedQueryItem {
  id: number;
  name: string;
  query: string;
  createdAt: string;
  updatedAt: string;
}
