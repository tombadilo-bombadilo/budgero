/**
 * Formats a SQL query with basic formatting rules (lightweight indentation).
 * Shared between the admin SQL explorer and the Explorer page.
 */
export function formatSQL(query: string): string {
  return query
    .replace(/\s+/g, ' ')
    .replace(/\b(SELECT|FROM|WHERE|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT)\b/gi, '\n$1')
    .replace(/\b(LEFT|RIGHT|INNER|OUTER)\s+(JOIN)\b/gi, '\n$1 $2')
    .replace(/,/g, ',\n  ')
    .trim();
}
