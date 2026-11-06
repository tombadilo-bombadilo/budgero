/**
 * Saved questions store the compiled SQL with a first-line header holding the
 * notebook spec, so they reopen in the notebook without a schema change and
 * still run anywhere a saved report runs (dashboards, executeReportQuery):
 *
 *   -- budgero-question:v2 {"source":"transactions",...}
 *   WITH ... SELECT ...
 *
 * The first builder wrote `-- budgero-builder: {json}` (v1); those headers are
 * still read and upgraded to v2.
 */
import { upgradeLegacySpec } from './legacy-v1';
import { normalizeQuestion, type QuestionSpec } from './spec';

export const QUESTION_HEADER_PREFIX = '-- budgero-question:v2';
export const LEGACY_HEADER_PREFIX = '-- budgero-builder:';

function firstLine(query: string): string {
  return query.replace(/^\s+/, '').split('\n', 1)[0] ?? '';
}

/** Compact spec for the header: drops empty / default parts. */
function compactQuestion(spec: QuestionSpec): Record<string, unknown> {
  return {
    source: spec.source,
    ...(spec.filters.length > 0 ? { filters: spec.filters } : {}),
    ...(spec.aggregations.length > 0 ? { aggregations: spec.aggregations } : {}),
    ...(spec.breakouts.length > 0 ? { breakouts: spec.breakouts } : {}),
    ...(spec.sort.length > 0 ? { sort: spec.sort } : {}),
    ...(spec.limit !== null ? { limit: spec.limit } : {}),
    ...(spec.columns ? { columns: spec.columns } : {}),
    visualization: spec.visualization,
  };
}

/** `-- budgero-question:v2 {...}`. JSON.stringify never emits a raw newline. */
export function serializeQuestionHeader(spec: QuestionSpec): string {
  return `${QUESTION_HEADER_PREFIX} ${JSON.stringify(compactQuestion(normalizeQuestion(spec)))}`;
}

/** The query stored for a saved question: header line + compiled SQL. */
export function buildSavedQuestionQuery(spec: QuestionSpec, sql: string): string {
  return `${serializeQuestionHeader(spec)}\n${sql}`;
}

function parseJsonObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The notebook spec stored in a saved query's header (v2, or v1 upgraded to
 * v2), or null for plain SQL reports.
 */
export function parseQuestionHeader(query: string | null | undefined): QuestionSpec | null {
  if (!query) return null;
  const line = firstLine(query);
  if (line.startsWith(QUESTION_HEADER_PREFIX)) {
    const json = parseJsonObject(line.slice(QUESTION_HEADER_PREFIX.length).trim());
    return json ? normalizeQuestion({ ...json, v: 2 }) : null;
  }
  if (line.startsWith(LEGACY_HEADER_PREFIX)) {
    const json = parseJsonObject(line.slice(LEGACY_HEADER_PREFIX.length).trim());
    return json ? upgradeLegacySpec(json) : null;
  }
  return null;
}

/** True when a saved query was produced by the notebook (or the v1 builder). */
export function isQuestionQuery(query: string | null | undefined): boolean {
  return parseQuestionHeader(query) !== null;
}

/** The SQL body of a saved query without its notebook header line. */
export function stripQuestionHeader(query: string): string {
  const trimmed = query.replace(/^\s+/, '');
  const line = firstLine(trimmed);
  if (!line.startsWith(QUESTION_HEADER_PREFIX) && !line.startsWith(LEGACY_HEADER_PREFIX)) {
    return query;
  }
  const newline = trimmed.indexOf('\n');
  return newline === -1 ? '' : trimmed.slice(newline + 1);
}
