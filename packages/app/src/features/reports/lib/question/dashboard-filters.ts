/**
 * Dashboard-level filters (date range, accounts, category groups), stored
 * with the dashboard as JSON and applied to every notebook-question widget at
 * run time. A filter only applies where the question's source has the field:
 * Accounts questions ignore the date and category groups, Budget questions
 * ignore accounts.
 *
 * Date: the dashboard range replaces the question's own range on the same
 * field (a "last 12 months" widget shows last year when the dashboard says
 * so). Accounts / category groups narrow the question (AND).
 */
import { PRIMARY_DATE_FIELD, getField, type QuestionSource } from './fields';
import {
  isValidIsoDate,
  normalizeFilter,
  normalizeQuestion,
  type QuestionFilter,
  type QuestionSpec,
} from './spec';

export const DASHBOARD_DATE_PRESETS = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'last6Months',
  'last12Months',
  'thisYear',
  'lastYear',
  'custom',
] as const;
export type DashboardDatePreset = (typeof DASHBOARD_DATE_PRESETS)[number];

export interface DashboardDateFilter {
  preset: DashboardDatePreset;
  /** Custom range only (inclusive ISO dates). */
  from?: string;
  to?: string;
}

export interface DashboardFilters {
  date?: DashboardDateFilter;
  /** Account ids. */
  accounts?: number[];
  /** Category group ids. */
  categoryGroups?: number[];
}

const MAX_IDS = 200;

function ids(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
        .filter((entry) => Number.isSafeInteger(entry) && entry > 0)
    )
  ).slice(0, MAX_IDS);
  return list.length > 0 ? list : undefined;
}

/** Valid filters from untrusted JSON; empty object when nothing is set. */
export function normalizeDashboardFilters(input: unknown): DashboardFilters {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const filters: DashboardFilters = {};

  const date = raw.date as Record<string, unknown> | undefined;
  if (date && typeof date === 'object') {
    const preset = DASHBOARD_DATE_PRESETS.find((entry) => entry === date.preset);
    if (preset === 'custom') {
      const from = isValidIsoDate(date.from) ? date.from : undefined;
      const to = isValidIsoDate(date.to) ? date.to : undefined;
      if (from && to) {
        filters.date = from <= to ? { preset, from, to } : { preset, from: to, to: from };
      }
    } else if (preset) {
      filters.date = { preset };
    }
  }
  const accounts = ids(raw.accounts);
  if (accounts) filters.accounts = accounts;
  const categoryGroups = ids(raw.categoryGroups);
  if (categoryGroups) filters.categoryGroups = categoryGroups;
  return filters;
}

export function hasDashboardFilters(filters: DashboardFilters): boolean {
  return Boolean(filters.date || filters.accounts?.length || filters.categoryGroups?.length);
}

/** The question filter a date preset stands for, on a given date field. */
export function dateFilterFor(field: string, date: DashboardDateFilter): QuestionFilter | null {
  switch (date.preset) {
    case 'thisMonth':
      return { field, op: 'current', values: [], unit: 'month' };
    case 'lastMonth':
      return { field, op: 'previous', values: [], unit: 'month', amount: 1, includeCurrent: false };
    case 'last3Months':
      return { field, op: 'previous', values: [], unit: 'month', amount: 3, includeCurrent: true };
    case 'last6Months':
      return { field, op: 'previous', values: [], unit: 'month', amount: 6, includeCurrent: true };
    case 'last12Months':
      return { field, op: 'previous', values: [], unit: 'month', amount: 12, includeCurrent: true };
    case 'thisYear':
      return { field, op: 'current', values: [], unit: 'year' };
    case 'lastYear':
      return { field, op: 'previous', values: [], unit: 'year', amount: 1, includeCurrent: false };
    case 'custom':
      return date.from && date.to ? { field, op: 'between', values: [date.from, date.to] } : null;
  }
}

export type DashboardFilterKind = 'date' | 'accounts' | 'categoryGroups';

export interface AppliedDashboardFilters {
  spec: QuestionSpec;
  /** Dashboard filters that changed this question. */
  applied: DashboardFilterKind[];
  /** Set dashboard filters this question's source has no field for. */
  ignored: DashboardFilterKind[];
}

function hasField(source: QuestionSource, field: string): boolean {
  return Boolean(getField(source, field));
}

/**
 * The question with the dashboard's filters merged in (see module doc).
 * Dashboard filters go first, so a question at the editor's filter limit
 * still takes them; `applied` lists only those the merged question really has.
 */
export function applyDashboardFilters(
  input: QuestionSpec,
  filters: DashboardFilters
): AppliedDashboardFilters {
  const spec = normalizeQuestion(input);
  const ignored: DashboardFilterKind[] = [];
  const added: { kind: DashboardFilterKind; filter: QuestionFilter }[] = [];
  let own = [...spec.filters];

  if (filters.date) {
    const field = PRIMARY_DATE_FIELD[spec.source];
    const filter = field ? dateFilterFor(field, filters.date) : null;
    if (field && filter) {
      // Replaces the question's own date range (date-part filters such as
      // "weekends only" stay).
      own = own.filter((entry) => entry.field !== field || entry.part !== undefined);
      added.push({ kind: 'date', filter });
    } else {
      ignored.push('date');
    }
  }
  if (filters.accounts?.length) {
    if (hasField(spec.source, 'account')) {
      added.push({
        kind: 'accounts',
        filter: { field: 'account', op: 'is', values: filters.accounts },
      });
    } else {
      ignored.push('accounts');
    }
  }
  if (filters.categoryGroups?.length) {
    if (hasField(spec.source, 'category_group')) {
      added.push({
        kind: 'categoryGroups',
        filter: { field: 'category_group', op: 'is', values: filters.categoryGroups },
      });
    } else {
      ignored.push('categoryGroups');
    }
  }
  if (added.length === 0) return { spec, applied: [], ignored };
  const merged = normalizeQuestion({
    ...spec,
    filters: [...added.map((entry) => entry.filter), ...own],
  });
  const kept = new Set(merged.filters.map((filter) => JSON.stringify(filter)));
  const applied = added
    .filter((entry) => kept.has(JSON.stringify(normalizeFilter(merged.source, entry.filter))))
    .map((entry) => entry.kind);
  return { spec: merged, applied, ignored };
}
