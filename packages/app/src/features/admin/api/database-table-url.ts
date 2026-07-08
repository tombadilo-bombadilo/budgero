import type { DatabaseTableQueryOptions } from '@features/admin/model/admin-database';

/**
 * Builds the admin database table data endpoint, encoding the table name and
 * appending any pagination/ordering query parameters.
 */
export function buildDatabaseTableUrl(
  tableName: string,
  options: DatabaseTableQueryOptions = {}
): string {
  const params = new URLSearchParams();
  if (typeof options.limit === 'number') {
    params.set('limit', options.limit.toString());
  }
  if (typeof options.offset === 'number') {
    params.set('offset', options.offset.toString());
  }
  if (options.orderBy) {
    params.set('orderBy', options.orderBy);
  }
  if (options.orderDirection) {
    params.set('orderDirection', options.orderDirection);
  }

  const query = params.toString();
  return `/admin/database/tables/${encodeURIComponent(tableName)}${query ? `?${query}` : ''}`;
}
