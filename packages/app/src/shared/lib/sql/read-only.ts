/**
 * Determines whether a SQL query is read-only.
 *
 * Read-only queries start with one of: SELECT, WITH, EXPLAIN, DESCRIBE, SHOW, PRAGMA
 * (after any leading `--` / `/* *\/` comments, e.g. the report builder's header).
 * Shared between the report query executor and the Explorer page.
 */
const READ_ONLY_PREFIXES = ['select', 'with', 'explain', 'describe', 'show', 'pragma'] as const;

/** Removes leading whitespace and leading SQL comments. */
export function stripLeadingSqlComments(sql: string): string {
  let rest = sql.trimStart();
  for (;;) {
    if (rest.startsWith('--')) {
      const newline = rest.indexOf('\n');
      rest = newline === -1 ? '' : rest.slice(newline + 1).trimStart();
    } else if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      rest = end === -1 ? '' : rest.slice(end + 2).trimStart();
    } else {
      return rest;
    }
  }
}

export function isReadOnlyQuery(sql: string): boolean {
  const trimmed = stripLeadingSqlComments(sql).toLowerCase();
  return READ_ONLY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}
