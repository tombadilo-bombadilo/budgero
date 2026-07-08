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
}

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
  budgetId: number;
  transactionsImported: number;
  /** Rows that were not imported (no amount / unparseable amount / failed). */
  transactionsSkipped?: number;
  accountsCreated: number;
  categoriesCreated: number;
  destinationAccountName?: string;
}

export interface PreviewRow {
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
  { value: '1,234.56', label: 'US/UK (1,234.56)' },
  { value: '1.234,56', label: 'European (1.234,56)' },
  { value: '1 234.56', label: 'French (1 234.56)' },
  { value: '1 234,56', label: 'French Alt (1 234,56)' },
  { value: "1'234.56", label: "Swiss (1'234.56)" },
] as const;

export const SUPPORTED_DATE_FORMATS = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-01-31)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (01/31/2024)' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/01/2024)' },
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY (31.01.2024)' },
  { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD (2024/01/31)' },
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
