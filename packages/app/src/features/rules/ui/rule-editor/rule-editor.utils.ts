import type {
  RuleCondition,
  RuleAction,
  RuleActionType,
  RuleConditionField,
  MemoConditionOperator,
  PayeeConditionOperator,
  AmountConditionOperator,
  AccountConditionOperator,
  Category,
  Account,
} from '@budgero/core/browser';
import { asMilli, fromDecimal, toDecimal } from '@shared/lib/currency/milli';

function coerceToString(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

// Stored rule JSON carries money in integer milliunits; the editor's form
// state holds user-facing DECIMAL strings. Convert on the way in
// (normalize*) and back out (convert*). Percentages stay dimensionless.
function milliToDecimalString(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? String(toDecimal(asMilli(num))) : '';
}

export const memoOperators: MemoConditionOperator[] = ['equals', 'contains', 'regex'];
export const payeeOperators: PayeeConditionOperator[] = ['equals', 'contains', 'regex'];
export const amountOperators: AmountConditionOperator[] = ['=', '!=', '>', '>=', '<', '<='];
export const accountOperators: AccountConditionOperator[] = ['is', 'is_not'];

export type RuleFormCondition = {
  field: RuleConditionField;
  operator:
    | MemoConditionOperator
    | PayeeConditionOperator
    | AmountConditionOperator
    | AccountConditionOperator;
  value: string;
  caseSensitive?: boolean;
};

export type RuleFormAction = {
  type: RuleActionType;
  payload: Record<string, string | number | undefined>;
};

export function normalizeCondition(condition: RuleCondition): RuleFormCondition {
  if (condition.field === 'amount') {
    return {
      field: 'amount',
      operator: condition.operator,
      value: milliToDecimalString(condition.value),
    };
  }
  if (condition.field === 'account') {
    return {
      field: 'account',
      operator: condition.operator,
      value: condition.value?.toString?.() ?? '',
    };
  }
  if (condition.field === 'payee') {
    return {
      field: 'payee',
      operator: condition.operator,
      value: condition.value?.toString?.() ?? '',
      caseSensitive: condition.options?.caseSensitive ?? false,
    };
  }
  return {
    field: 'memo',
    operator: condition.operator,
    value: condition.value?.toString?.() ?? '',
    caseSensitive: condition.options?.caseSensitive ?? false,
  };
}

export function normalizeAction(action: RuleAction): RuleFormAction {
  if (action.type === 'amount.set') {
    return { type: action.type, payload: { amount: milliToDecimalString(action.payload.amount) } };
  }
  if (action.type === 'amount.adjust_value') {
    return { type: action.type, payload: { delta: milliToDecimalString(action.payload.delta) } };
  }
  return {
    type: action.type,
    payload: { ...action.payload },
  };
}

export function createDefaultCondition(): RuleFormCondition {
  return {
    field: 'memo',
    operator: 'contains',
    value: '',
    caseSensitive: false,
  };
}

export function createDefaultAction(categories?: Category[]): RuleFormAction {
  if (categories && categories.length > 0) {
    return {
      type: 'category.set',
      payload: getDefaultPayload('category.set', categories, []),
    };
  }
  return {
    type: 'memo.remove_regex',
    payload: getDefaultPayload('memo.remove_regex', [], []),
  };
}

export function getDefaultPayload(
  type: RuleActionType,
  categories: Category[],
  accounts: Account[]
): Record<string, string | number | undefined> {
  switch (type) {
    case 'memo.remove_regex':
      return { pattern: '', flags: 'gi' };
    case 'memo.set':
      return { memo: '' };
    case 'category.set':
      return { categoryId: categories[0]?.ID ?? '' };
    case 'payee.set':
      return { payee: '' };
    case 'account.set':
      return { accountId: accounts[0]?.ID ?? '' };
    case 'amount.set':
      return { amount: '' };
    case 'amount.adjust_value':
      return { delta: '' };
    case 'amount.adjust_percent':
      return { percent: '' };
    default:
      return {};
  }
}

export function convertCondition(condition: RuleFormCondition): RuleCondition {
  if (condition.field === 'amount') {
    return {
      field: 'amount',
      operator: condition.operator as AmountConditionOperator,
      // User-typed decimal → stored milliunits
      value: fromDecimal(Number(condition.value)),
    };
  }
  if (condition.field === 'account') {
    return {
      field: 'account',
      operator: condition.operator as AccountConditionOperator,
      value: Number(condition.value),
    };
  }
  if (condition.field === 'payee') {
    return {
      field: 'payee',
      operator: condition.operator as PayeeConditionOperator,
      value: condition.value,
      options:
        condition.operator === 'regex' || condition.caseSensitive
          ? { caseSensitive: Boolean(condition.caseSensitive) }
          : undefined,
    };
  }
  return {
    field: 'memo',
    operator: condition.operator as MemoConditionOperator,
    value: condition.value,
    options:
      condition.operator === 'regex' || condition.caseSensitive
        ? { caseSensitive: Boolean(condition.caseSensitive) }
        : undefined,
  };
}

export function convertAction(action: RuleFormAction): RuleAction {
  switch (action.type) {
    case 'memo.remove_regex':
      return {
        type: 'memo.remove_regex',
        payload: {
          pattern: String(action.payload.pattern ?? ''),
          flags: String(action.payload.flags ?? 'gi'),
        },
      };
    case 'memo.set': {
      const memo = coerceToString(action.payload.memo);
      return {
        type: 'memo.set',
        payload: { memo },
      };
    }
    case 'category.set':
      return {
        type: 'category.set',
        payload: { categoryId: Number(action.payload.categoryId) },
      };
    case 'payee.set': {
      const payee = coerceToString(action.payload.payee);
      return {
        type: 'payee.set',
        payload: { payee: payee.trim() },
      };
    }
    case 'account.set':
      return {
        type: 'account.set',
        payload: { accountId: Number(action.payload.accountId) },
      };
    case 'amount.set':
      return {
        type: 'amount.set',
        // User-typed decimal → stored milliunits
        payload: { amount: fromDecimal(Number(action.payload.amount)) },
      };
    case 'amount.adjust_value':
      return {
        type: 'amount.adjust_value',
        payload: { delta: fromDecimal(Number(action.payload.delta)) },
      };
    case 'amount.adjust_percent':
      return {
        type: 'amount.adjust_percent',
        payload: { percent: Number(action.payload.percent) },
      };
    default:
      return action as RuleAction;
  }
}

export function validateForm(
  name: string,
  conditions: RuleFormCondition[],
  actions: RuleFormAction[]
): string | null {
  if (!name.trim()) {
    return 'Give your rule a name so you can recognise it later.';
  }

  if (conditions.length === 0) {
    return 'Add at least one condition to control when the rule runs.';
  }

  for (const condition of conditions) {
    if (condition.field === 'amount') {
      if (condition.value === '' || Number.isNaN(Number(condition.value))) {
        return 'Amount conditions require a numeric value.';
      }
    } else if (condition.field === 'account') {
      if (!condition.value || Number.isNaN(Number(condition.value))) {
        return 'Select an account for the account condition.';
      }
    } else if (condition.field === 'payee') {
      if (!condition.value.trim()) {
        return 'Payee conditions cannot be empty.';
      }
    } else if (!condition.value.trim()) {
      return 'Memo conditions cannot be empty.';
    }
  }

  if (actions.length === 0) {
    return 'Add at least one action for Budgero to perform.';
  }

  for (const action of actions) {
    switch (action.type) {
      case 'memo.remove_regex':
        if (!action.payload.pattern?.toString().trim()) {
          return 'Provide a regex pattern for the memo action.';
        }
        break;
      case 'memo.set':
        if (typeof action.payload.memo !== 'string') {
          return 'Enter a memo value for the memo action.';
        }
        break;
      case 'category.set':
        if (!Number.isFinite(Number(action.payload.categoryId))) {
          return 'Pick a category for the category action.';
        }
        break;
      case 'payee.set':
        if (typeof action.payload.payee !== 'string') {
          return 'Enter a payee name for the payee action.';
        }
        break;
      case 'account.set':
        if (!Number.isFinite(Number(action.payload.accountId))) {
          return 'Choose an account for the account action.';
        }
        break;
      case 'amount.set':
        if (action.payload.amount === '' || Number.isNaN(Number(action.payload.amount))) {
          return 'Provide a valid amount for the set amount action.';
        }
        break;
      case 'amount.adjust_value':
        if (action.payload.delta === '' || Number.isNaN(Number(action.payload.delta))) {
          return 'Provide a numeric delta for the adjust value action.';
        }
        break;
      case 'amount.adjust_percent':
        if (action.payload.percent === '' || Number.isNaN(Number(action.payload.percent))) {
          return 'Provide a numeric percentage for the adjust percent action.';
        }
        break;
      default:
        break;
    }
  }

  return null;
}

export function getOperatorLabel(operator: string): string {
  switch (operator) {
    case 'regex':
      return 'Regex match';
    case 'is_not':
      return 'is not';
    case 'is':
      return 'is';
    default:
      return operator;
  }
}
