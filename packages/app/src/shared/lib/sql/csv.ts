/**
 * The one CSV writer: SQL explorer, question / dashboard / pivot downloads.
 *
 * - Header and cells are quoted when they hold a comma, quote, line break or
 *   outer spaces.
 * - Numbers stay raw and dates become ISO text, so spreadsheets can compute.
 * - Text starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`:
 *   spreadsheets would otherwise run it as a formula (CSV injection).
 *
 * The empty-cell coercion differs by caller (`cell ?? ''` vs `cell || ''`),
 * which changes how 0/false cells render, so it is exposed via `emptyValue`.
 */
export interface ResultsToCsvOptions {
  /**
   * Maps each cell to a string. Defaults to raw numbers, ISO dates and ''
   * for null/undefined.
   */
  emptyValue?: (cell: unknown) => string;
  /**
   * Prefix formula-like text with `'` (default true). Raw data dumps that
   * must round-trip byte for byte turn it off.
   */
  defuseFormulas?: boolean;
}

function isoDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return '';
  const iso = value.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

const defaultEmptyValue = (cell: unknown): string => {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return isoDate(cell);
  if (typeof cell === 'object') {
    try {
      return JSON.stringify(cell) ?? '';
    } catch {
      return String(cell);
    }
  }
  return String(cell);
};

const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\n\r]|^\s|\s$/;

/** Text that a spreadsheet would run as a formula, defused with a leading apostrophe. */
function defuse(text: string): string {
  return FORMULA_START.test(text) && !NUMERIC_TEXT.test(text) ? `'${text}` : text;
}

function quote(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV field: `raw` is the original cell (numbers are never defused). */
export function csvField(text: string, raw: unknown = text, defuseFormulas = true): string {
  const numeric = typeof raw === 'number' || typeof raw === 'bigint';
  return quote(numeric || !defuseFormulas ? text : defuse(text));
}

export function resultsToCsv(
  columns: string[],
  rows: unknown[][],
  options?: ResultsToCsvOptions
): string {
  const coerce = options?.emptyValue ?? defaultEmptyValue;
  const defuseFormulas = options?.defuseFormulas ?? true;
  return [
    columns.map((column) => csvField(column, column, defuseFormulas)).join(','),
    ...rows.map((row) => row.map((cell) => csvField(coerce(cell), cell, defuseFormulas)).join(',')),
  ].join('\n');
}
