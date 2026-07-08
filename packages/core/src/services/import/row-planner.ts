/**
 * Import row planner.
 *
 * Pure, dependency-free transformation of one parsed CSV/statement row into the
 * fields a transaction needs (date, inflow, outflow, payee, memo), plus an
 * explicit STATUS that says whether the row will be imported or skipped, plus
 * human-readable `errors` to surface in the preview.
 *
 * This mirrors exactly the per-row logic the import dialog runs in its import
 * loop, factored out so the "does this row silently disappear?" decision is
 * unit-testable against real CSV fixtures.
 *
 * Historically this logic lived inside a React hook and was never covered by
 * tests. Rows whose amount failed to parse — an empty cell, garbage like
 * "Pending"/"N/A", or a Debit/Credit column the user did not map — were
 * collapsed to a zero amount and dropped without any error, while the UI still
 * reported every row as imported. See `import-row-planner.node.spec.ts`.
 */

import { fromDecimal, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import { parseAmountDetailed, parseDate } from './parsing.js';
import type { ColumnMapping } from './types.js';

export type ImportRowStatus =
  /** Row has a parseable amount (including an explicit zero) and will import. */
  | 'ready'
  /** An amount cell was present but could not be parsed — surfaced, not imported. */
  | 'error'
  /** No amount value at all — surfaced as a skip, not imported. */
  | 'skipped-empty';

/** Separator + date settings needed to turn raw cells into numbers/dates. */
export interface ImportRowParseConfig {
  thousandSeparator: string;
  decimalSeparator: string;
  dateFormat: string;
  defaultYear?: number;
}

export interface PlannedImportRow {
  /** Index into the rows array that was planned. */
  index: number;
  status: ImportRowStatus;
  date: string;
  inflow: MilliUnits;
  outflow: MilliUnits;
  payee: string;
  memo: string;
  /** Human-readable issues to show in the preview (warnings and blockers). */
  errors: string[];
}

interface AmountResult {
  inflow: MilliUnits;
  outflow: MilliUnits;
  status: ImportRowStatus;
  errors: string[];
}

function resolveAmounts(
  row: Record<string, string>,
  columnMapping: ColumnMapping,
  config: ImportRowParseConfig
): AmountResult {
  const errors: string[] = [];
  // Parsed cell values are decimal floats; converted to milliunits at assignment
  let inflow = ZERO_MILLI;
  let outflow = ZERO_MILLI;
  // A cell parsed to a real number (including an explicit 0 like "$0.00").
  let parsedAny = false;
  // A present cell could not be parsed (e.g. "Pending").
  let hadParseError = false;

  if (columnMapping.amount) {
    const raw = row[columnMapping.amount] ?? '';
    const parsed = parseAmountDetailed(raw, config, true);
    if (parsed.empty) {
      // No amount on a single-amount mapping — nothing to import.
    } else if (!parsed.ok) {
      errors.push(`Could not parse amount "${raw.trim()}"`);
      hadParseError = true;
    } else {
      parsedAny = true;
      if (parsed.value > 0) inflow = fromDecimal(parsed.value);
      else outflow = fromDecimal(Math.abs(parsed.value));
    }
  } else if (columnMapping.inflow || columnMapping.outflow) {
    if (columnMapping.inflow) {
      const raw = row[columnMapping.inflow] ?? '';
      const parsed = parseAmountDetailed(raw, config);
      if (!parsed.empty) {
        if (!parsed.ok) {
          errors.push(`Could not parse inflow "${raw.trim()}"`);
          hadParseError = true;
        } else {
          parsedAny = true;
          inflow = fromDecimal(parsed.value);
        }
      }
    }
    if (columnMapping.outflow) {
      const raw = row[columnMapping.outflow] ?? '';
      const parsed = parseAmountDetailed(raw, config);
      if (!parsed.empty) {
        if (!parsed.ok) {
          errors.push(`Could not parse outflow "${raw.trim()}"`);
          hadParseError = true;
        } else {
          parsedAny = true;
          outflow = fromDecimal(parsed.value);
        }
      }
    }
  } else {
    errors.push('No amount column mapped');
    hadParseError = true;
  }

  let status: ImportRowStatus;
  if (parsedAny) {
    // A real number (incl. zero) wins even if another cell was garbage, so a
    // genuine "$0.00" row imports instead of being dropped.
    status = 'ready';
  } else if (hadParseError) {
    status = 'error';
  } else {
    status = 'skipped-empty';
    errors.push('No amount value — row will be skipped');
  }

  return { inflow, outflow, status, errors };
}

/**
 * Plan a single row. Pure — no DB, no category/account resolution (those are
 * async side-effects the caller performs for rows that come back `ready`).
 */
export function planImportRow(
  row: Record<string, string>,
  index: number,
  columnMapping: ColumnMapping,
  config: ImportRowParseConfig
): PlannedImportRow {
  const errors: string[] = [];

  const dateStr = columnMapping.date ? row[columnMapping.date] : '';
  if (!dateStr || !dateStr.trim()) {
    errors.push('No date found — using today');
  }
  const date = parseDate(dateStr ?? '', config.dateFormat, config.defaultYear);

  const amount = resolveAmounts(row, columnMapping, config);
  errors.push(...amount.errors);

  const payee = columnMapping.payee ? String(row[columnMapping.payee] || '').trim() : '';
  const memo =
    (columnMapping.memo ? [row[columnMapping.memo]] : [])
      .filter(Boolean)
      .map((part) => String(part).trim())
      .filter((part) => part.length > 0)
      .join(' | ') || 'Imported transaction';

  return {
    index,
    status: amount.status,
    date,
    inflow: amount.inflow,
    outflow: amount.outflow,
    payee,
    memo,
    errors,
  };
}

/** Plan every row, preserving order and original index. */
export function planImportRows(
  rows: Record<string, string>[],
  columnMapping: ColumnMapping,
  config: ImportRowParseConfig
): PlannedImportRow[] {
  return rows.map((row, index) => planImportRow(row, index, columnMapping, config));
}

export interface ImportPlanSummary {
  /** Total rows planned. */
  total: number;
  /** Rows that will produce a transaction (`status: 'ready'`). */
  ready: number;
  /** Rows skipped because a present amount could not be parsed. */
  errored: number;
  /** Rows skipped because they carried no amount value. */
  skippedEmpty: number;
}

/** Roll a set of planned rows up into the counts the UI should report. */
export function summarizeImportPlan(plans: PlannedImportRow[]): ImportPlanSummary {
  let ready = 0;
  let errored = 0;
  let skippedEmpty = 0;
  for (const plan of plans) {
    if (plan.status === 'ready') ready += 1;
    else if (plan.status === 'error') errored += 1;
    else skippedEmpty += 1;
  }
  return { total: plans.length, ready, errored, skippedEmpty };
}
