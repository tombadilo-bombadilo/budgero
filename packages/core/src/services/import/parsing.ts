/**
 * Statement-import parsing utilities.
 *
 * Pure parsing/transformation helpers for the CSV/PDF import wizard:
 * amount parsing, format-aware date parsing, delimiter/column detection,
 * and delimited-text tokenization. No DB or UI dependencies.
 */

import type { ColumnMapping } from './types.js';
import { getLocalDateString } from '../../utils/date.js';
import { clock } from '../../utils/clock.js';

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

  // Bank exports — PDF text layers especially — write the minus sign as a
  // Unicode dash (U+2212 MINUS SIGN, U+2010 HYPHEN, en/em/figure/horizontal-
  // bar dashes, U+FF0D FULLWIDTH minus in CJK statements). The cleanup below
  // would strip those as "currency symbols", silently turning a spend into
  // income, so fold them to ASCII "-" before anything looks for a sign.
  let original = amountStr.trim().replace(/[‐‒–—―−－]/g, '-');

  // Dutch/German whole-amount notation writes "12,–" / "1.234,-" for exactly
  // 12.00 / 1234.00 — a dash RIGHT AFTER the decimal separator stands for
  // "00", it is not a minus. Rewrite it before the sign detection below reads
  // it as a trailing minus and negates the amount. Real trailing-minus values
  // ("54.20-") have digits before the dash, so they don't match.
  original = original.replace(/([.,])\s*-$/, (_m, sep: string) => `${sep}00`);

  // Remove currency symbols and whitespace, keep only digits and separators
  let cleaned = original.replace(/[^\d.,()-]/g, '');

  // Detect negative formats before stripping. The minus only has to come
  // before the first digit, not at the very start of the cell: "$-54.20" and
  // "USD -54.20" are as negative as "-54.20".
  const hasParens = original.includes('(') && original.includes(')');
  const hasLeadingMinus = /^\D*-/.test(original);
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

export interface ParsedImportDate {
  /** ISO `YYYY-MM-DD`. Today's date when the input could not be read. */
  date: string;
  /**
   * True when `date` was actually read out of the input. False means `date`
   * is the today fallback — either an empty cell or an unrecognized value.
   */
  ok: boolean;
  /** True when the input was empty/whitespace (distinct from present-but-garbage). */
  empty: boolean;
}

/**
 * Parse a date string based on the configured date format, reporting WHETHER
 * the input was actually understood.
 *
 * The bare {@link parseDate} API returns today's date for empty cells,
 * unreadable values ("31/01/2024 12:30", "20240131") and a genuine import of
 * today alike — which is how whole statements used to import with every
 * transaction silently stamped with the import date. This variant
 * distinguishes three cases so callers can surface a real error instead:
 *  - empty cell              → `{ ok: false, empty: true }`
 *  - present but unreadable  → `{ ok: false, empty: false }`  e.g. "n/a"
 *  - a real date             → `{ ok: true }`
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
export function parseDateDetailed(
  dateStr: string,
  dateFormat: string,
  defaultYear?: number
): ParsedImportDate {
  if (!dateStr || !dateStr.trim()) {
    return { date: getLocalDateString(), ok: false, empty: true };
  }

  const trimmed = dateStr.trim();
  const found = (date: string): ParsedImportDate => ({ date, ok: true, empty: false });

  // 1) Try the configured format first (requires a year).
  const formatted = parseWithFormat(trimmed, dateFormat);
  if (formatted) return found(formatted);

  // 2) Yearless "Mon DD" / "DD Mon" (common in US/Canadian credit card
  //    statements). Apply the configured default year or today's year.
  const yearless = parseYearlessDate(trimmed, defaultYear ?? clock.date().getFullYear());
  if (yearless) return found(yearless);

  // 3) ISO-leading dates ("2024-01-31", "2024-01-31T12:34:56Z"): return the
  //    written calendar date verbatim. Parsing via new Date() would anchor
  //    date-only strings to UTC and shift them for users west of UTC.
  const isoDateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/);
  if (isoDateOnly) return found(isoDateOnly[1]);

  // 4) A bare 4-digit year ("2024") → January 1 of that year, written out
  //    directly. JS Date would parse it too, but anchored to UTC midnight,
  //    which shifts to Dec 31 for users west of UTC.
  if (/^\d{4}$/.test(trimmed)) {
    const year = parseInt(trimmed, 10);
    if (year >= 1900 && year <= 2999) return found(`${year}-01-01`);
  }

  // 5) Fall back to JS Date for textual formats (e.g. "Jan 31, 2024"), which
  //    parse as LOCAL midnight — so serialize with local getters, never
  //    toISOString() (UTC), which shifts the day for users east of UTC.
  //    Bare digit runs are excluded: earlier steps already handled the ones
  //    that are real dates, and JS Date reads whatever is left as a YEAR
  //    ("12345" → Jan 1 of year 12345), inventing a date out of a mis-mapped
  //    column.
  if (!/^\d+$/.test(trimmed)) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return found(getLocalDateString(date));
    }
  }

  // 6) Last-ditch: today, flagged so the caller can warn about it.
  return { date: getLocalDateString(), ok: false, empty: false };
}

/**
 * Parse a date string to an ISO `YYYY-MM-DD` string, falling back to today.
 *
 * Thin wrapper over {@link parseDateDetailed} for callers that only need the
 * date. Prefer `parseDateDetailed` when you must distinguish a date that was
 * really read from the today fallback (e.g. to surface an import error).
 */
export function parseDate(dateStr: string, dateFormat: string, defaultYear?: number): string {
  return parseDateDetailed(dateStr, dateFormat, defaultYear).date;
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
 * Strips a trailing time-of-day from a date cell: "31/01/2024 12:30",
 * "31.01.2024. 12:30:45", "01/31/2024 11:59 PM", "2024-01-31T12:30:45Z".
 *
 * Bank exports routinely put a timestamp in the date column. Without this the
 * extra token pushed the field count past three and the whole statement fell
 * through to the today fallback.
 */
const TRAILING_TIME_RE =
  /[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\s*(?:[AP]\.?M\.?)?\s*(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})?$/i;

/**
 * Turn the separated fields of a date into three numbers, in the same order
 * they appear in the input.
 *
 * Two shapes are accepted: three numeric fields ("31/01/2024", "2024-1-5"),
 * and a separator-less run of EXACTLY 8 digits ("20240131") whose field
 * widths follow the configured format's field order. 6-digit runs are
 * deliberately rejected: with the two-digit-year heuristic almost any
 * reference/ID number ("150323") reads as a plausible date, so a mis-mapped
 * numeric column would import as scattered fabricated dates with no warning.
 * An 8-digit run must contain a real 4-digit year in the right slot, which
 * filters most non-dates.
 */
function parseFieldNumbers(parts: string[], fmt: string): [number, number, number] | null {
  if (parts.length === 3) {
    if (!parts.every((part) => /^\d{1,4}$/.test(part))) return null;
    const [a, b, c] = parts.map((part) => parseInt(part, 10));
    return [a, b, c];
  }

  if (parts.length !== 1 || !/^\d{8}$/.test(parts[0])) return null;

  const digits = parts[0];
  const widths: [number, number, number] = fmt.startsWith('YYYY') ? [4, 2, 2] : [2, 2, 4];

  let offset = 0;
  const nums = widths.map((width) => {
    const value = parseInt(digits.slice(offset, offset + width), 10);
    offset += width;
    return value;
  });
  return nums as [number, number, number];
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
 *
 * A trailing time-of-day is ignored, and separator-less dates ("20240131",
 * "310124") are read according to the same field order as the format.
 */
function parseWithFormat(dateStr: string, dateFormat: string): string | null {
  const fmt = dateFormat.toUpperCase();
  const dateOnly = dateStr.replace(TRAILING_TIME_RE, '').trim();

  const parts = dateOnly.split(/[-/.\s]+/).filter((p) => p.length > 0);
  const nums = parseFieldNumbers(parts, fmt);
  if (!nums) return null;

  let year: number;
  let month: number;
  let day: number;

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
 * Parse complete delimited records, preserving newlines inside quoted fields.
 *
 * Splitting the input on `\n` before parsing is not CSV-safe: RFC-style CSV
 * permits a quoted memo to contain CRLF/newline characters. YNAB uses that
 * representation for multiline memos, so records must be tokenized across
 * the complete file rather than one physical line at a time.
 */
export function parseCSVRecords(text: string, delimiter = ','): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    record.push(field.trim());
    field = '';
  };

  const pushRecord = () => {
    pushField();
    if (record.some((value) => value.length > 0)) {
      records.push(record);
    }
    record = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      pushField();
      continue;
    }

    if (char === '\r' || char === '\n') {
      const isCrLf = char === '\r' && text[index + 1] === '\n';
      if (inQuotes) {
        field += '\n';
      } else {
        pushRecord();
      }
      if (isCrLf) index++;
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error('Malformed delimited file: unterminated quoted field');
  }

  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }

  return records;
}

/**
 * Parse delimited plain text into headers/rows for import preview and processing.
 */
export function parseDelimitedText(text: string, skipRows = 0): ParsedDelimitedText {
  const physicalLines = text.split(/\r?\n/).filter((line) => line.trim());

  if (physicalLines.length <= skipRows) {
    throw new Error('No data rows found after skipping specified rows');
  }

  const sample = physicalLines.slice(skipRows, skipRows + 5).join('\n');
  const delimiter = detectDelimiter(sample);
  const records = parseCSVRecords(text, delimiter);

  if (records.length <= skipRows) {
    throw new Error('No data rows found after skipping specified rows');
  }

  const headers = records[skipRows];
  const rows = records.slice(skipRows + 1).map((fields) => {
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
