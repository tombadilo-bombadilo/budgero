export type { QueryResult } from '@shared/lib/sql/report-query-executor';

export interface TableInfo {
  name: string;
  objectType?: 'table' | 'view';
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
  }[];
  rowCount: number;
}

/** SQL.js prepared statement interface */
export interface SqlStatement {
  all(): Record<string, unknown>[];
  get(): Record<string, unknown> | undefined;
  finalize(): void;
}

/** SQL.js database interface for raw queries */
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): { columns?: string[]; values?: unknown[][] }[];
}

/** SQLite pragma table_info column result */
export interface SqliteColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}
