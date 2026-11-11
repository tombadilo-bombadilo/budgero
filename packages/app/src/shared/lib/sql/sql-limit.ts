/**
 * The automatic row cap for report queries. Only a top-level trailing
 * `LIMIT n [OFFSET m]` is the user's limit: LIMIT inside string literals,
 * quoted identifiers, comments or parentheses (sub-queries, CTEs) is not.
 */

/** The query with strings, quoted names and comments blanked out (same length). */
function maskSql(query: string): string {
  let out = '';
  let index = 0;
  while (index < query.length) {
    const char = query[index];
    const next = query[index + 1];
    let end = -1;
    if (char === "'" || char === '"') {
      end = index + 1;
      while (end < query.length) {
        if (query[end] === char) {
          if (query[end + 1] === char) end += 2;
          else break;
        } else end += 1;
      }
      end = Math.min(end + 1, query.length);
    } else if (char === '-' && next === '-') {
      const newline = query.indexOf('\n', index);
      end = newline === -1 ? query.length : newline;
    } else if (char === '/' && next === '*') {
      const close = query.indexOf('*/', index + 2);
      end = close === -1 ? query.length : close + 2;
    }
    if (end === -1) {
      out += char;
      index += 1;
    } else {
      out += ' '.repeat(end - index);
      index = end;
    }
  }
  return out;
}

/** The masked query with everything inside parentheses blanked out too. */
function topLevelOnly(masked: string): string {
  let depth = 0;
  let out = '';
  for (const char of masked) {
    if (char === '(') {
      depth += 1;
      out += ' ';
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      out += ' ';
    } else {
      out += depth > 0 ? ' ' : char;
    }
  }
  return out;
}

export interface TopLevelLimit {
  value: number;
  /** Span of `LIMIT n` in the original query. */
  start: number;
  end: number;
}

/** The query's trailing top-level `LIMIT n` (optionally followed by OFFSET m and a `;`). */
export function topLevelLimit(query: string): TopLevelLimit | null {
  const visible = topLevelOnly(maskSql(query));
  const match = /\bLIMIT\s+(\d+)(?:\s+OFFSET\s+\d+)?\s*;?\s*$/i.exec(visible);
  if (!match) return null;
  const digits = /\bLIMIT\s+\d+/i.exec(match[0])!;
  const start = match.index;
  return { value: parseInt(match[1], 10), start, end: start + digits[0].length };
}

export function applyQueryLimit(
  query: string,
  maxRows: number
): { query: string; userLimit: number | null; effectiveLimit: number } {
  const limit = topLevelLimit(query);
  if (!limit) {
    return { query: `${query} LIMIT ${maxRows}`, userLimit: null, effectiveLimit: maxRows };
  }
  if (limit.value > maxRows) {
    return {
      query: `${query.slice(0, limit.start)}LIMIT ${maxRows}${query.slice(limit.end)}`,
      userLimit: limit.value,
      effectiveLimit: maxRows,
    };
  }
  return { query, userLimit: limit.value, effectiveLimit: limit.value };
}

/** Row count of the query without its own top-level LIMIT. */
export function createCountQuery(query: string): string {
  const limit = topLevelLimit(query);
  const withoutLimit = limit ? query.slice(0, limit.start) + query.slice(limit.end) : query;
  return `SELECT COUNT(*) as count FROM (${withoutLimit}) as subquery`;
}
