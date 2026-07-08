import { resultsToCsv } from '@shared/lib/sql/csv';
import { formatSQL } from '@shared/lib/sql/format';
import { WRITE_OPERATIONS } from './constants';
import type { QueryResult } from './types';

export { formatSQL };

/**
 * Detects if a SQL query is a write operation (INSERT, UPDATE, DELETE, etc.)
 */
export function isWriteQuery(query: string): boolean {
  const normalizedQuery = query.trim().toUpperCase();
  return WRITE_OPERATIONS.some((op) => normalizedQuery.startsWith(op));
}

/**
 * Converts a write query to a SELECT query for dry run mode.
 * Returns the original query if it's not a write operation or cannot be converted.
 */
export function convertToDryRunQuery(queryToRun: string): string {
  const upperQuery = queryToRun.toUpperCase();

  if (upperQuery.startsWith('UPDATE')) {
    // Convert UPDATE to SELECT to show affected rows
    // UPDATE table SET ... WHERE ... -> SELECT * FROM table WHERE ...
    const tableMatch = queryToRun.match(/UPDATE\s+(\S+)\s+SET/i);
    const whereMatch = queryToRun.match(/WHERE\s+(.+)$/i);

    if (tableMatch && tableMatch[1]) {
      const tableName = tableMatch[1];
      const whereClause = whereMatch ? `WHERE ${whereMatch[1]}` : '';
      return `SELECT '(dry run) Rows that would be updated' as _dry_run_mode, * FROM ${tableName} ${whereClause}`;
    }
  } else if (upperQuery.startsWith('DELETE')) {
    // Convert DELETE to SELECT to show affected rows
    // DELETE FROM table WHERE ... -> SELECT * FROM table WHERE ...
    const tableMatch = queryToRun.match(/DELETE\s+FROM\s+(\S+)/i);
    const whereMatch = queryToRun.match(/WHERE\s+(.+)$/i);

    if (tableMatch && tableMatch[1]) {
      const tableName = tableMatch[1];
      const whereClause = whereMatch ? `WHERE ${whereMatch[1]}` : '';
      return `SELECT '(dry run) Rows that would be deleted' as _dry_run_mode, * FROM ${tableName} ${whereClause}`;
    }
  } else if (upperQuery.startsWith('INSERT')) {
    // For INSERT, just show the values that would be inserted
    return `SELECT '(dry run) Insert operation would add new row(s)' as _dry_run_mode, 'Original query: ${queryToRun.substring(0, 100)}...' as query`;
  } else if (
    upperQuery.startsWith('DROP') ||
    upperQuery.startsWith('ALTER') ||
    upperQuery.startsWith('CREATE')
  ) {
    // For DDL operations, just show what would happen
    return `SELECT '(dry run) DDL operation' as _dry_run_mode, '${queryToRun.split(' ').slice(0, 3).join(' ')}...' as operation, 'Would modify database schema' as effect`;
  }

  return queryToRun;
}

/**
 * Converts query results to CSV format
 */
export function convertResultsToCSV(result: QueryResult): string {
  if (!result || result.columns.length === 0) return '';

  return resultsToCsv(result.columns, result.rows);
}

/**
 * Checks if results should show truncation warning
 */
export function shouldShowTruncatedWarning(result: QueryResult): boolean {
  return (
    result.rowCount > result.fetchedRows || result.truncated || result.rowCount > result.rows.length
  );
}
