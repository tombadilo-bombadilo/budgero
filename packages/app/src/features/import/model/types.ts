import { msg } from '@lingui/core/macro';
import type { DuplicatePlan, DuplicateInput } from '@budgero/core/browser';
/**
 * Import Feature Types
 *
 * Shared types used across the CSV/PDF import wizard components.
 */

export type ImportStep = 'upload' | 'configure' | 'preview' | 'import' | 'complete';

export interface ImportSource {
  type: 'csv' | 'pdf' | 'ofx' | 'qif' | 'camt';
  file: File;
  fileName: string;
}

export interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
  source: ImportSource;
}

export interface ColumnMapping {
  date?: string;
  amount?: string;
  inflow?: string;
  outflow?: string;
  description?: string;
  memo?: string;
  payee?: string;
  account?: string;
  category?: string;
  // Index signature keeps this assignable to the core ColumnMapping consumed by
  // the import row-planner.
  [key: string]: string | undefined;
}

export interface ImportConfig {
  numberFormat: string;
  thousandSeparator: string;
  decimalSeparator: string;
  dateFormat: string;
  skipRows: number;
  accountCurrency: string;
  defaultAccountId: number | null;
  /**
   * Year to apply to dates that only contain month+day (e.g. "Oct 25" from
   * CIBC statements). Ignored when dates already include a year.
   */
  defaultYear?: number;
  /**
   * The user's own choice for values of the file's Account column. Values
   * without one get a default (see planAccountRoutes in lib/account-routes.ts).
   */
  accountRoutes?: Record<string, AccountRoute>;
}

export type AccountRoute =
  { kind: 'existing'; accountId: number } | { kind: 'new'; name: string } | { kind: 'skip' };

export interface ImportTemplate {
  id: string;
  name: string;
  description?: string;
  columnMapping: ColumnMapping;
  numberFormat: string;
  thousandSeparator?: string;
  decimalSeparator?: string;
  dateFormat: string;
  skipRows?: number;
  accountCurrency?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportProgress {
  step: string;
  progress: number;
  currentItem: string;
  isComplete: boolean;
  error?: string;
}

export interface ImportSummary {
  duplicatesSkipped?: number;
  /** Rows matched to an existing transaction, which was marked cleared. */
  transactionsMatched?: number;
  userSkipped?: number;
  invalidRows?: number;
  failedRows?: number;
  failures?: { index: number; message: string }[];
  budgetId: number;
  transactionsImported: number;
  /** Rows that were not imported (no amount / unparseable amount / failed). */
  transactionsSkipped?: number;
  accountsCreated: number;
  categoriesCreated: number;
  destinationAccountName?: string;
}

/**
 * skip: keep the existing transaction unchanged; import: add the row as new;
 * match: keep the existing transaction and mark it cleared (YNAB-style).
 */
export type ImportDecision = 'skip' | 'import' | 'match';

/** A row imported as a transfer with another account of the import (lib/plan-transfers.ts). */
export interface FileTransfer {
  /** The account the other side goes to (a placeholder id when it is new). */
  counterpartAccountId: number;
  /** The other account as the file names it. */
  counterpartName: string;
  /** The row holding the other side, when it is in the file. */
  partnerIndex?: number;
}

/**
 * A row marked as a transfer with an account that is not in the file, whose
 * other side that account already has: imported as a plain transaction.
 */
export interface OtherSideExists {
  counterpartName: string;
  /** The transaction already in that account. */
  transactionId: number;
}

export interface PreviewRow {
  input: DuplicateInput;
  duplicate: DuplicatePlan;
  decision?: ImportDecision;
  /** The row's account is set to "Don't import": skipped by the user, not invalid. */
  accountSkipped?: boolean;
  transfer?: FileTransfer;
  otherSideExists?: OtherSideExists;
  original: Record<string, string>;
  parsed: {
    date?: string;
    /** Display-only DECIMAL amount (signed) — converted from planned milliunits. */
    amount?: number;
    /** Display-only DECIMAL amount — converted from planned milliunits. */
    inflow?: number;
    /** Display-only DECIMAL amount — converted from planned milliunits. */
    outflow?: number;
    payee?: string;
    memo?: string;
    account?: string;
  };
  errors: string[];
}

export interface RawTableData {
  pageNumber: number;
  allRows: string[][];
  headers: string[];
  rows: string[][];
  columnCount: number;
  suggestedHeaderIndex: number;
}

export const SUPPORTED_NUMBER_FORMATS = [
  { value: '1,234.56', label: msg`US/UK (1,234.56)` },
  { value: '1.234,56', label: msg`European (1.234,56)` },
  { value: '1 234.56', label: msg`French (1 234.56)` },
  { value: '1 234,56', label: msg`French Alt (1 234,56)` },
  { value: "1'234.56", label: msg`Swiss (1'234.56)` },
] as const;

export const SUPPORTED_DATE_FORMATS = [
  { value: 'YYYY-MM-DD', label: msg`YYYY-MM-DD (2024-01-31)` },
  { value: 'MM/DD/YYYY', label: msg`MM/DD/YYYY (01/31/2024)` },
  { value: 'DD/MM/YYYY', label: msg`DD/MM/YYYY (31/01/2024)` },
  { value: 'DD.MM.YYYY', label: msg`DD.MM.YYYY (31.01.2024)` },
  { value: 'YYYY/MM/DD', label: msg`YYYY/MM/DD (2024/01/31)` },
] as const;

export const DEFAULT_IMPORT_CONFIG: ImportConfig = {
  numberFormat: '1,234.56',
  thousandSeparator: ',',
  decimalSeparator: '.',
  dateFormat: 'YYYY-MM-DD',
  skipRows: 0,
  accountCurrency: 'USD',
  defaultAccountId: null,
};
