import {
  goalTargetCurrency,
  toDecimal,
  type Goal,
  type GoalRateSource,
} from '@budgero/core/browser';
import { buildCurrencyLocalizer } from '@shared/store/useUiStore';

/** Number format used when the budget has none (same default as the register rows). */
const DEFAULT_NUMBER_FORMAT = '$1,096.56';

/** A formatter for amounts in `currency`, in the budget's number format. */
export function goalCurrencyFormatter(
  currency: string,
  numberFormat: string | null | undefined
): Intl.NumberFormat {
  return (
    buildCurrencyLocalizer(currency, numberFormat ?? DEFAULT_NUMBER_FORMAT) ??
    buildCurrencyLocalizer(currency, DEFAULT_NUMBER_FORMAT) ??
    new Intl.NumberFormat()
  );
}

/** The budget currency a budget-currency formatter shows. */
export function formatterCurrency(formatter: Intl.NumberFormat): string | undefined {
  return formatter.resolvedOptions().currency;
}

export interface GoalTargetDisplay {
  /** The target in its own currency (the budget's for most goals). */
  target: string;
  /** The target in the budget currency, for goals in another currency; else null. */
  converted: string | null;
  /** The goal's own currency when it differs from the budget's; else null. */
  currency: string | null;
  /** Where the conversion rate came from (only for goals in another currency). */
  rateSource: GoalRateSource | null;
}

/**
 * How a goal's target reads: in its own currency, plus the budget-currency
 * amount every calculation uses when the two differ.
 */
export function describeGoalTarget(
  goal: Pick<Goal, 'Target' | 'TargetCurrency' | 'TargetConverted' | 'TargetRateSource'>,
  budgetFormatter: Intl.NumberFormat,
  numberFormat: string | null | undefined
): GoalTargetDisplay {
  const currency = goalTargetCurrency(goal, formatterCurrency(budgetFormatter));
  if (!currency) {
    return {
      target: budgetFormatter.format(toDecimal(goal.Target)),
      converted: null,
      currency: null,
      rateSource: null,
    };
  }
  return {
    target: goalCurrencyFormatter(currency, numberFormat).format(toDecimal(goal.Target)),
    converted:
      typeof goal.TargetConverted === 'number'
        ? budgetFormatter.format(toDecimal(goal.TargetConverted))
        : null,
    currency,
    rateSource: goal.TargetRateSource ?? null,
  };
}
