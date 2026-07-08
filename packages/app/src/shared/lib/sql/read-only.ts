/**
 * Determines whether a SQL query is read-only.
 *
 * Read-only queries start with one of: SELECT, WITH, EXPLAIN, DESCRIBE, SHOW, PRAGMA.
 * Shared between the report query executor and the Explorer page.
 */
const READ_ONLY_PREFIXES = ['select', 'with', 'explain', 'describe', 'show', 'pragma'] as const;

export function isReadOnlyQuery(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  return READ_ONLY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}
