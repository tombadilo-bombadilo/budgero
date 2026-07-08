import type { GetTransactionsByAccountRow } from '@budgero/core/browser';

export type CurrencyDisplay = 'budget' | 'account';

/**
 * Builds a flow accessor from a budget-currency field and its original-currency
 * counterpart. When `preferOriginal` is true, the original value is used unless
 * it's falsy (zero/null/undefined), in which case it falls back to the budget
 * value — a 0-valued original amount displays the budget amount rather than 0.
 */
function makeFlowAccessor(
  primary: (tx: GetTransactionsByAccountRow) => number,
  original: (tx: GetTransactionsByAccountRow) => number,
  preferOriginal: boolean
): (tx: GetTransactionsByAccountRow) => number {
  return (tx) => (preferOriginal ? original(tx) || primary(tx) : primary(tx));
}

const inflowBudget = (tx: GetTransactionsByAccountRow) => tx.Inflow;
const inflowOriginal = (tx: GetTransactionsByAccountRow) => tx.InflowOriginal ?? 0;
const outflowBudget = (tx: GetTransactionsByAccountRow) => tx.Outflow;
const outflowOriginal = (tx: GetTransactionsByAccountRow) => tx.OutflowOriginal ?? 0;

export interface AmountAccessors {
  getPrimaryInflow: (tx: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (tx: GetTransactionsByAccountRow) => number;
  getSecondaryInflow: (tx: GetTransactionsByAccountRow) => number;
  getSecondaryOutflow: (tx: GetTransactionsByAccountRow) => number;
}

/**
 * Builds the primary/secondary inflow/outflow accessors for a given currency
 * display preference. "Primary" is the amount shown in the main column;
 * "secondary" is the smaller amount shown alongside it (account currency when
 * displaying budget currency, or vice versa).
 *
 * Shared by TransactionsTable and the spending drawer (which always renders
 * with `display: 'budget'`).
 */
export function makeAmountAccessors(display: CurrencyDisplay): AmountAccessors {
  const preferOriginal = display !== 'budget';
  return {
    getPrimaryInflow: makeFlowAccessor(inflowBudget, inflowOriginal, preferOriginal),
    getPrimaryOutflow: makeFlowAccessor(outflowBudget, outflowOriginal, preferOriginal),
    getSecondaryInflow: makeFlowAccessor(inflowBudget, inflowOriginal, !preferOriginal),
    getSecondaryOutflow: makeFlowAccessor(outflowBudget, outflowOriginal, !preferOriginal),
  };
}
