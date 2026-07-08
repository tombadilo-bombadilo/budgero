import { DEFAULT_MAX_ROWS, executeDuckDbReportQuery } from './duckdb-reporting-engine';
import { isReadOnlyQuery } from './read-only';

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTime: number;
}

export interface SqlStatement {
  all(): Record<string, unknown>[];
  get(): Record<string, unknown> | undefined;
  finalize(): void;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

export type ReportQueryErrorCode =
  | 'EMPTY_QUERY'
  | 'NON_READ_ONLY_QUERY'
  | 'DATABASE_UNAVAILABLE'
  | 'EXECUTION_FAILED';

export class ReportQueryExecutionError extends Error {
  constructor(
    public readonly code: ReportQueryErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ReportQueryExecutionError';
  }
}

const MAX_CONCURRENT_EXECUTIONS = 3;

let activeExecutions = 0;
const executionQueue: (() => void)[] = [];

function acquireExecutionSlot(): Promise<void> {
  if (activeExecutions < MAX_CONCURRENT_EXECUTIONS) {
    activeExecutions += 1;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    executionQueue.push(() => {
      activeExecutions += 1;
      resolve();
    });
  });
}

function releaseExecutionSlot(): void {
  activeExecutions = Math.max(0, activeExecutions - 1);
  const next = executionQueue.shift();
  if (next) next();
}

export function getNormalizedReportQueryError(error: unknown): ReportQueryExecutionError {
  if (error instanceof ReportQueryExecutionError) return error;
  if (error instanceof Error) {
    return new ReportQueryExecutionError('EXECUTION_FAILED', error.message);
  }
  return new ReportQueryExecutionError('EXECUTION_FAILED', 'Query execution failed');
}

export async function executeReportQuery(
  query: string,
  db: SqlDatabase | null,
  options?: { maxRows?: number }
): Promise<QueryResult> {
  await acquireExecutionSlot();

  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new ReportQueryExecutionError('EMPTY_QUERY', 'Query is empty');
    }
    if (!db) {
      throw new ReportQueryExecutionError('DATABASE_UNAVAILABLE', 'Database is not available');
    }
    if (!isReadOnlyQuery(trimmedQuery)) {
      throw new ReportQueryExecutionError(
        'NON_READ_ONLY_QUERY',
        'Widgets support read-only SELECT/WITH/EXPLAIN/DESCRIBE/SHOW/PRAGMA queries only.'
      );
    }

    const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
    return await executeDuckDbReportQuery(trimmedQuery, db, { maxRows });
  } catch (error) {
    throw getNormalizedReportQueryError(error);
  } finally {
    releaseExecutionSlot();
  }
}
