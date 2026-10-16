import type { Account } from '@budgero/core/browser';
import { fromDecimal, toDecimal, type MilliUnits } from '@shared/lib/currency/milli';

/** Account.Metadata arrives as a JSON string from SQLite, or as an object. */
export function parseAccountMetadata(
  metadata: Account['Metadata'] | null | undefined
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(metadata || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return { ...metadata };
}

/** The liability fields the edit form exposes; money is in DECIMAL form. */
export interface LiabilityFormFields {
  debtTotal: number;
  interestRate: number;
  startDate: string;
  targetDate: string;
}

export function liabilityFormFromMetadata(md: Record<string, unknown>): LiabilityFormFields {
  return {
    debtTotal: typeof md.debt_total === 'number' ? toDecimal(md.debt_total as MilliUnits) : 0,
    interestRate: typeof md.interest_rate_annual === 'number' ? md.interest_rate_annual : 0,
    startDate: typeof md.start_date === 'string' ? md.start_date : '',
    targetDate: typeof md.target_date === 'string' ? md.target_date : '',
  };
}

/**
 * The minimum payment an edit stores: the calculated one when its inputs
 * changed (or nothing is stored yet) and it can be calculated, else the stored
 * one. Credit cards have no target date, so their entered minimum survives.
 */
export function resolveMinPayment(
  md: Record<string, unknown>,
  initial: LiabilityFormFields,
  form: LiabilityFormFields,
  computed: MilliUnits | null
): MilliUnits | undefined {
  const stored =
    typeof md.min_payment_monthly === 'number' ? (md.min_payment_monthly as MilliUnits) : undefined;
  const inputsChanged =
    form.interestRate !== initial.interestRate || form.targetDate !== initial.targetDate;
  if (computed !== null && (inputsChanged || stored === undefined)) return computed;
  return stored;
}

/**
 * Merge an edit into the stored metadata: only fields the user changed are
 * overwritten, so keys the form doesn't show (term_years, paid_so_far, links,
 * importer ids) survive. A cleared field is dropped.
 */
export function mergeLiabilityMetadata(
  md: Record<string, unknown>,
  accType: string,
  initial: LiabilityFormFields,
  form: LiabilityFormFields,
  computedMinPayment: MilliUnits | null
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...md,
    liability: true,
    liability_type: accType.toLowerCase(),
    payment_frequency: md.payment_frequency ?? 'monthly',
  };
  if (form.debtTotal !== initial.debtTotal) {
    next.debt_total = form.debtTotal > 0 ? fromDecimal(form.debtTotal) : undefined;
  }
  if (form.interestRate !== initial.interestRate) {
    next.interest_rate_annual = form.interestRate > 0 ? form.interestRate : undefined;
  }
  if (form.startDate !== initial.startDate) {
    next.start_date = form.startDate || undefined;
  }
  if (form.targetDate !== initial.targetDate) {
    next.target_date = form.targetDate || undefined;
  }
  next.min_payment_monthly = resolveMinPayment(md, initial, form, computedMinPayment);
  return next;
}
