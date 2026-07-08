export interface DatabaseTableSummary {
  name: string;
  rowCount: number;
  description?: string | null;
  schema?: string | null;
  columns?: DatabaseTableColumn[];
}

export interface DatabaseTableColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: unknown;
}

export type DatabaseRow = Record<string, unknown>;

export interface DatabaseTableDataResponse {
  columns: DatabaseTableColumn[];
  rows: DatabaseRow[];
  totalCount: number;
  primaryKey?: string[];
}

export interface UpdateDatabaseRowRequest {
  primaryKey: Record<string, unknown>;
  updates: Record<string, unknown>;
}

export interface UpdateDatabaseRowResponse {
  success: boolean;
  row?: DatabaseRow;
}

export interface DatabaseTableQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface AdminQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTime: number;
  message?: string;
  truncated?: boolean;
}
