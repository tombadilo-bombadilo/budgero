/**
 * Statement-import parsing utilities.
 *
 * Pure parsing/transformation helpers for the CSV/PDF import wizard:
 * amount parsing, format-aware date parsing, delimiter/column detection,
 * and delimited-text tokenization. No DB or UI dependencies.
 */

import type { ColumnMapping } from './types.js';
import { getLocalDateString } from '../../utils/date.js';

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;
type SupportedDelimiter = (typeof DELIMITER_CANDIDATES)[number];

export type ParsedDelimitedText = {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: SupportedDelimiter;
};

export interface ParsedAmount {
  /** Numeric value. 0 when not parseable. Signed only when `preserveSign`. */
  value: number;
  /**
   * True when the input contained a recognizable number — INCLUDING an
   * explicit zero such as "$0.00" or "0,00". False for empty or garbage input.
   */
  ok: boolean;
  /** True when the input was empty/whitespace (distinct from present-but-garbage). */
  empty: boolean;
}

/**
 * Parse an amount string based on configured separators, reporting WHETHER the
 * input was actually a number.
 *
 * The bare {@link parseAmount} API returns 0 for empty cells, garbage
 * ("Pending", "N/A") and a genuine zero alike — which is how rows used to be
 * silently dropped during import. This variant distinguishes three cases so
 * callers can surface real errors instead:
 *  - empty cell             → `{ ok: false, empty: true }`
 *  - present but unparseable → `{ ok: false, empty: false }`  e.g. "Pending"
 *  - a real number incl. 0   → `{ ok: true }`                 e.g. "$0.00"
 *
 * Handles various negative formats: parentheses, leading/trailing minus.
 */
export function parseAmountDetailed(
  amountStr: string,
  config: { thousandSeparator: string; decimalSeparator: string },
  preserveSign = false
): ParsedAmount {
  if (!amountStr || !amountStr.trim()) return { value: 0, ok: false, empty: true };

  // Remove currency symbols and whitespace, keep only digits and separators
  let cleaned = amountStr.replace(/[^\d.,()-]/g, '');

  // Detect negative formats before stripping
  const original = amountStr.trim();
  const hasParens = original.includes('(') && original.includes(')');
  const hasLeadingMinus = /^\s*-/.test(original);
  const hasTrailingMinus = /-\s*$/.test(original);
  const isNegative = hasParens || hasLeadingMinus || hasTrailingMinus;

  // Normalize parentheses and trailing minus to leading minus for parsing
  cleaned = cleaned.replace(/[()]/g, '');
  if (/-$/.test(cleaned)) {
    cleaned = `-${cleaned.replace(/-$/, '')}`;
  }

  const { thousandSeparator, decimalSeparator } = config;

  if (
    thousandSeparator &&
    thousandSeparator !== 'none' &&
    decimalSeparator &&
    thousandSeparator !== decimalSeparator
  ) {
    // First remove thousand separators
    const thousandRegex = new RegExp(`\\${thousandSeparator}`, 'g');
    cleaned = cleaned.replace(thousandRegex, '');

    // Then convert decimal separator to standard dot if needed
    if (decimalSeparator !== '.') {
      const decimalRegex = new RegExp(`\\${decimalSeparator}`, 'g');
      cleaned = cleaned.replace(decimalRegex, '.');
    }
  } else {
    // Fallback: try to detect based on position and digit count
    // If last separator has 1-2 digits after it, it's likely decimal
    const lastCommaPos = cleaned.lastIndexOf(',');
    const lastDotPos = cleaned.lastIndexOf('.');

    if (lastCommaPos > lastDotPos && lastCommaPos > -1) {
      // Comma is last separator
      const afterComma = cleaned.substring(lastCommaPos + 1);
      if (afterComma.length <= 2 && afterComma.length > 0) {
        // Comma is decimal separator
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        // Comma is thousand separator
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (lastDotPos > lastCommaPos && lastDotPos > -1) {
      // Dot is last separator
      const afterDot = cleaned.substring(lastDotPos + 1);
      if (afterDot.length <= 2 && afterDot.length > 0) {
        // Dot is decimal separator, remove commas
        cleaned = cleaned.replace(/,/g, '');
      } else {
        // Dot is thousand separator
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      }
    }
  }

  const amount = parseFloat(cleaned);
  if (Number.isNaN(amount)) return { value: 0, ok: false, empty: false };

  const value = preserveSign && isNegative ? -Math.abs(amount) : Math.abs(amount);
  return { value, ok: true, empty: false };
}

/**
 * Parse an amount string to a number, returning 0 for empty/unparseable input.
 *
 * Thin wrapper over {@link parseAmountDetailed} for callers that only need the
 * number. Prefer `parseAmountDetailed` when you must distinguish a genuine zero
 * from an unreadable value (e.g. to surface an import error).
 */
export function parseAmount(
  amountStr: string,
  config: { thousandSeparator: string; decimalSeparator: string },
  preserveSign = false
): number {
  return parseAmountDetailed(amountStr, config, preserveSign).value;
}

/**
 * Parse a date string based on the configured date format.
 * Returns ISO date string (YYYY-MM-DD).
 *
 * The configured `dateFormat` is honored FIRST. We only fall back to
 * `new Date(...)` if the format-aware parse fails, because JavaScript's
 * Date constructor happily mis-parses strings like "10.03.2026" as
 * MM.DD.YYYY (October 3, 2026) when the user actually meant DD.MM.YYYY
 * (March 10, 2026), which would import transactions into the future.
 *
 * `defaultYear` is used for "Mon DD" style dates (e.g. "Oct 25") that
 * carry no year — common in credit card statements. If omitted and a
 * yearless date is encountered, the current year is used.
 */
export function parseDate(dateStr: string, dateFormat: string, defaultYear?: number): string {
  if (!dateStr) return getLocalDateString();

  const trimmed = dateStr.trim();

  // 1) Try the configured format first (requires a year).
  const formatted = parseWithFormat(trimmed, dateFormat);
  if (formatted) return formatted;

  // 2) Yearless "Mon DD" / "DD Mon" (common in US/Canadian credit card
  //    statements). Apply the configured default year or today's year.
  const yearless = parseYearlessDate(trimmed, defaultYear ?? new Date().getFullYear());
  if (yearless) return yearless;

  // 3) ISO-leading dates ("2024-01-31", "2024-01-31T12:34:56Z"): return the
  //    written calendar date verbatim. Parsing via new Date() would anchor
  //    date-only strings to UTC and shift them for users west of UTC.
  const isoDateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/);
  if (isoDateOnly) return isoDateOnly[1];

  // 4) Fall back to JS Date for textual formats (e.g. "Jan 31, 2024"), which
  //    parse as LOCAL midnight — so serialize with local getters, never
  //    toISOString() (UTC), which shifts the day for users east of UTC.
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return getLocalDateString(date);
  }

  // 5) Last-ditch: today.
  return getLocalDateString();
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i;
const YEARLESS_MON_DAY = /^([a-z]+)\s+(\d{1,2})$/i;
const YEARLESS_DAY_MON = /^(\d{1,2})\s+([a-z]+)$/i;

function monthNumber(word: string): number | undefined {
  if (!MONTH_RE.test(word)) return undefined;
  const key = word.toLowerCase().slice(0, 3);
  // `sept` normalizes to `sep` via slice
  return MONTH_NAMES[key];
}

/**
 * Match dates that look like "Oct 25", "October 25", "Oct. 25", "25 Oct",
 * etc. Returns an ISO date string using `year`, or null if the input
 * doesn't match a yearless month+day pattern.
 */
function parseYearlessDate(dateStr: string, year: number): string | null {
  const clean = dateStr.trim().replace(/\s+/g, ' ').replace(/\./g, '');

  let month: number | undefined;
  let day: number | undefined;

  const m1 = clean.match(YEARLESS_MON_DAY);
  if (m1) {
    month = monthNumber(m1[1]);
    day = parseInt(m1[2], 10);
  } else {
    const m2 = clean.match(YEARLESS_DAY_MON);
    if (m2) {
      day = parseInt(m2[1], 10);
      month = monthNumber(m2[2]);
    }
  }

  if (month == null || day == null) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2999) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Returns true when the given raw date string looks like "Mon DD" / "DD Mon"
 * with no year. Used by the configure step to decide whether to show the
 * "Default year" input.
 */
export function dateStringLacksYear(dateStr: string): boolean {
  const clean = dateStr.trim().replace(/\s+/g, ' ').replace(/\./g, '');
  if (!clean) return false;
  // Any 4-digit sequence → treat as already having a year.
  if (/\d{4}/.test(clean)) return false;
  // Numeric "dd/mm/yy" / "dd.mm.yy" / "dd-mm-yy" at the end — treat as having
  // a (2-digit) year.
  if (/[./-]\d{2}$/.test(clean)) return false;
  const m1 = clean.match(YEARLESS_MON_DAY);
  if (m1 && monthNumber(m1[1]) != null) return true;
  const m2 = clean.match(YEARLESS_DAY_MON);
  if (m2 && monthNumber(m2[2]) != null) return true;
  return false;
}

/**
 * Try to parse `dateStr` strictly against the given `dateFormat`.
 * Returns an ISO `YYYY-MM-DD` string on success, or `null` on failure.
 *
 * Supported formats (mirrors `SUPPORTED_DATE_FORMATS`):
 *   YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY, DD.MM.YYYY
 *
 * The separator in the format ("-", "/", ".") doesn't have to match the
 * input — we accept any of `-`, `/`, `.` as a separator regardless. This
 * is intentional: bank statements sometimes use mixed separators, and the
 * meaningful information is the field order, not the punctuation.
 */
function parseWithFormat(dateStr: string, dateFormat: string): string | null {
  const parts = dateStr.split(/[-/.\s]+/).filter((p) => p.length > 0);
  if (parts.length !== 3) return null;

  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;

  let year: number;
  let month: number;
  let day: number;

  const fmt = dateFormat.toUpperCase();
  if (fmt.startsWith('YYYY')) {
    // YYYY-MM-DD or YYYY/MM/DD
    [year, month, day] = nums;
  } else if (fmt.startsWith('DD')) {
    // DD/MM/YYYY or DD.MM.YYYY
    [day, month, year] = nums;
  } else if (fmt.startsWith('MM')) {
    // MM/DD/YYYY
    [month, day, year] = nums;
  } else {
    return null;
  }

  // Two-digit year heuristic: 00–69 → 2000s, 70–99 → 1900s.
  if (year < 100) {
    year += year < 70 ? 2000 : 1900;
  }

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2999) return null;

  // Cross-check the resulting date is valid (catches Feb 30, etc.).
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Auto-detect column mapping from headers.
 */
export function detectColumnMapping(headers: string[]): Partial<ColumnMapping> {
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  const mapping: Partial<ColumnMapping> = {};

  const datePatterns = ['date', 'transaction date', 'posted date', 'value date'];
  for (const pattern of datePatterns) {
    const match = lowerHeaders.find((h) => h.includes(pattern));
    if (match) {
      mapping.date = headers[lowerHeaders.indexOf(match)];
      break;
    }
  }

  const amountPatterns = ['amount', 'transaction amount', 'value'];
  for (const pattern of amountPatterns) {
    const match = lowerHeaders.find((h) => h.includes(pattern));
    if (match) {
      mapping.amount = headers[lowerHeaders.indexOf(match)];
      break;
    }
  }

  // If no single amount column, look for inflow/outflow
  if (!mapping.amount) {
    const inflowPatterns = ['inflow', 'credit', 'deposit', 'income'];
    for (const pattern of inflowPatterns) {
      const match = lowerHeaders.find((h) => h.includes(pattern));
      if (match) {
        mapping.inflow = headers[lowerHeaders.indexOf(match)];
        break;
      }
    }

    const outflowPatterns = ['outflow', 'debit', 'withdrawal', 'expense'];
    for (const pattern of outflowPatterns) {
      const match = lowerHeaders.find((h) => h.includes(pattern));
      if (match) {
        mapping.outflow = headers[lowerHeaders.indexOf(match)];
        break;
      }
    }
  }

  const payeePatterns = ['payee', 'merchant', 'counterparty', 'beneficiary'];
  for (const pattern of payeePatterns) {
    const matchIndex = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (matchIndex !== -1) {
      mapping.payee = headers[matchIndex];
      break;
    }
  }

  const memoPatterns = ['memo', 'note', 'reference', 'remarks'];
  for (const pattern of memoPatterns) {
    const matchIndex = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (matchIndex !== -1) {
      mapping.memo = headers[matchIndex];
      break;
    }
  }

  return mapping;
}

/**
 * Detect delimiter from a sample of delimited text.
 */
export function detectDelimiter(sample: string): SupportedDelimiter {
  const lines = sample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return ',';

  // Prefer header row detection first, then fallback to aggregate counts.
  const header = lines[0];
  const headerDelimiter = detectDelimiterForLine(header);
  if (headerDelimiter) {
    return headerDelimiter;
  }

  let bestDelimiter: SupportedDelimiter = ',';
  let maxCount = 0;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const count = lines.reduce(
      (sum, line) => sum + countDelimiterOutsideQuotes(line, delimiter),
      0
    );

    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

function detectDelimiterForLine(line: string): SupportedDelimiter | null {
  let bestDelimiter: SupportedDelimiter | null = null;
  let maxCount = 0;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const count = countDelimiterOutsideQuotes(line, delimiter);
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      count++;
    }
  }

  return count;
}

/**
 * Parse a delimited line handling quoted fields.
 */
export function parseCSVLine(line: string, delimiter = ','): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        currentField += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(currentField.trim());
      currentField = '';
      i++;
    } else {
      currentField += char;
      i++;
    }
  }

  fields.push(currentField.trim());
  return fields;
}

/**
 * Parse delimited plain text into headers/rows for import preview and processing.
 */
export function parseDelimitedText(text: string, skipRows = 0): ParsedDelimitedText {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length <= skipRows) {
    throw new Error('No data rows found after skipping specified rows');
  }

  const headerLine = lines[skipRows];
  const sample = lines.slice(skipRows, skipRows + 5).join('\n');
  const delimiter = detectDelimiter(sample);
  const headers = parseCSVLine(headerLine, delimiter);
  const rows = lines.slice(skipRows + 1).map((line) => {
    const fields = parseCSVLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = fields[index] || '';
    });
    return row;
  });

  return { headers, rows, delimiter };
}

/**
 * Get separator settings from a number format preset.
 */
export function getSeparatorsFromFormat(format: string): {
  thousandSeparator: string;
  decimalSeparator: string;
} {
  let thousandSep = ',';
  let decimalSep = '.';

  if (format === '1.234,56') {
    thousandSep = '.';
    decimalSep = ',';
  } else if (format === '1 234.56' || format === '1 234,56') {
    thousandSep = ' ';
    decimalSep = format.includes(',') ? ',' : '.';
  } else if (format === "1'234.56") {
    thousandSep = "'";
    decimalSep = '.';
  }

  return { thousandSeparator: thousandSep, decimalSeparator: decimalSep };
}
