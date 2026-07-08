import type {
  TransactionRule,
  RuleAction,
  RuleCondition,
  MemoConditionOperator,
  PayeeConditionOperator,
  AmountConditionOperator,
} from './index.js';

export interface AutofillContext {
  memo: string;
  payee: string;
  amount: number | null;
  accountId: number | null;
}

export interface AutofillSuggestion {
  field: 'category' | 'payee' | 'memo' | 'amount' | 'account';
  value: string | number;
  ruleId: number;
  ruleName: string;
}

/**
 * Check if a rule's conditions match the current form context.
 * Pure function for testability.
 */
export function matchesAutofillConditions(
  rule: TransactionRule,
  context: AutofillContext
): boolean {
  if (!rule.enabled || rule.mode !== 'autofill') return false;
  if (!rule.conditions || rule.conditions.length === 0) return false;

  return rule.conditions.every((condition) => matchesSingleCondition(condition, context));
}

function matchesSingleCondition(condition: RuleCondition, context: AutofillContext): boolean {
  const { field } = condition;
  const { operator } = condition;
  const condValue = String(condition.value ?? '');
  const caseSensitive = Boolean(condition.options?.caseSensitive);

  if (field === 'memo') {
    const memo = context.memo ?? '';
    return matchStringCondition(memo, operator as MemoConditionOperator, condValue, caseSensitive);
  }

  if (field === 'payee') {
    const payee = context.payee ?? '';
    return matchStringCondition(
      payee,
      operator as PayeeConditionOperator,
      condValue,
      caseSensitive
    );
  }

  if (field === 'amount' && context.amount !== null) {
    const numValue = parseFloat(condValue);
    if (!Number.isFinite(numValue)) return false;
    return matchNumericCondition(context.amount, operator as AmountConditionOperator, numValue);
  }

  if (field === 'account' && context.accountId !== null) {
    const condAccountId = parseInt(condValue, 10);
    if (!Number.isFinite(condAccountId)) return false;
    // Account conditions use 'is' and 'is_not' operators
    if (operator === 'is') return context.accountId === condAccountId;
    if (operator === 'is_not') return context.accountId !== condAccountId;
    return false;
  }

  return false;
}

function matchStringCondition(
  value: string,
  operator: MemoConditionOperator | PayeeConditionOperator,
  condValue: string,
  caseSensitive: boolean
): boolean {
  const valueForCompare = caseSensitive ? value : value.toLowerCase();
  const condValueForCompare = caseSensitive ? condValue : condValue.toLowerCase();

  switch (operator) {
    case 'equals':
      return valueForCompare === condValueForCompare;
    case 'contains':
      return condValueForCompare.length === 0
        ? false
        : valueForCompare.includes(condValueForCompare);
    case 'regex':
      try {
        const flags = caseSensitive ? 'g' : 'gi';
        return new RegExp(condValue, flags).test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function matchNumericCondition(
  value: number,
  operator: AmountConditionOperator,
  condValue: number
): boolean {
  switch (operator) {
    case '=':
      return Math.abs(value - condValue) < 0.001;
    case '!=':
      return Math.abs(value - condValue) >= 0.001;
    case '>':
      return value > condValue;
    case '<':
      return value < condValue;
    case '>=':
      return value >= condValue;
    case '<=':
      return value <= condValue;
    default:
      return false;
  }
}

/**
 * Get the set of fields used in a rule's conditions.
 * This is used to allow actions to overwrite fields that triggered the rule.
 */
function getConditionFields(rule: TransactionRule): Set<string> {
  const fields = new Set<string>();
  for (const condition of rule.conditions || []) {
    fields.add(condition.field);
  }
  return fields;
}

export interface ComputeAutofillOptions {
  /**
   * When true, ignore current field values and allow overwriting any field.
   * This is used when autofill runs for the first time in a session,
   * allowing it to overwrite prefilled values from "remember last".
   */
  ignoreCurrentValues?: boolean;
}

/**
 * Compute autofill suggestions from matching rules.
 * Returns suggestions only for fields that are currently empty,
 * OR for fields that were used as conditions (enabling shortcode patterns),
 * OR for any field if ignoreCurrentValues is true.
 * Pure function for testability.
 */
export function computeAutofillSuggestions(
  rules: TransactionRule[],
  context: AutofillContext,
  currentValues: {
    categoryId: number | null;
    payee: string;
    memo: string;
    amount: number | null;
    accountId: number | null;
  },
  rejectedFields: Set<string>,
  options: ComputeAutofillOptions = {}
): AutofillSuggestion[] {
  const { ignoreCurrentValues = false } = options;
  const suggestions: AutofillSuggestion[] = [];
  const suggestedFields = new Set<string>();

  // Sort rules by runOrder for deterministic priority
  const sortedRules = [...rules].sort((a, b) => a.runOrder - b.runOrder);

  for (const rule of sortedRules) {
    if (!matchesAutofillConditions(rule, context)) continue;

    // Get fields used in conditions - these can be overwritten by actions
    const conditionFields = getConditionFields(rule);

    for (const action of rule.actions || []) {
      const suggestion = actionToSuggestion(
        action,
        rule,
        currentValues,
        rejectedFields,
        suggestedFields,
        conditionFields,
        ignoreCurrentValues
      );
      if (suggestion) {
        suggestions.push(suggestion);
        suggestedFields.add(suggestion.field);
      }
    }
  }

  return suggestions;
}

function actionToSuggestion(
  action: RuleAction,
  rule: TransactionRule,
  currentValues: {
    categoryId: number | null;
    payee: string;
    memo: string;
    amount: number | null;
    accountId: number | null;
  },
  rejectedFields: Set<string>,
  suggestedFields: Set<string>,
  conditionFields: Set<string>,
  ignoreCurrentValues: boolean
): AutofillSuggestion | null {
  // Only suggest for empty fields OR fields that triggered the rule (shortcode pattern)
  // OR any field if ignoreCurrentValues is true (first autofill of session)
  // Fields that triggered the rule can be overwritten by actions

  if (action.type === 'category.set') {
    // Category isn't typically used as a condition field, but handle it anyway
    const canOverwrite = ignoreCurrentValues || conditionFields.has('category');
    if (currentValues.categoryId !== null && !canOverwrite) return null;
    if (rejectedFields.has('category') || suggestedFields.has('category')) return null;
    return {
      field: 'category',
      value: action.payload.categoryId,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  }

  if (action.type === 'payee.set') {
    const canOverwrite = ignoreCurrentValues || conditionFields.has('payee');
    if (currentValues.payee.trim() !== '' && !canOverwrite) return null;
    if (rejectedFields.has('payee') || suggestedFields.has('payee')) return null;
    return {
      field: 'payee',
      value: action.payload.payee,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  }

  if (action.type === 'memo.set') {
    // Allow memo.set to overwrite if memo was used as a condition (shortcode pattern)
    const canOverwrite = ignoreCurrentValues || conditionFields.has('memo');
    if (currentValues.memo.trim() !== '' && !canOverwrite) return null;
    if (rejectedFields.has('memo') || suggestedFields.has('memo')) return null;
    return {
      field: 'memo',
      value: action.payload.memo,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  }

  if (action.type === 'amount.set') {
    const canOverwrite = ignoreCurrentValues || conditionFields.has('amount');
    if (currentValues.amount !== null && !canOverwrite) return null;
    if (rejectedFields.has('amount') || suggestedFields.has('amount')) return null;
    return {
      field: 'amount',
      value: action.payload.amount,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  }

  if (action.type === 'account.set') {
    const canOverwrite = ignoreCurrentValues || conditionFields.has('account');
    if (currentValues.accountId !== null && !canOverwrite) return null;
    if (rejectedFields.has('account') || suggestedFields.has('account')) return null;
    return {
      field: 'account',
      value: action.payload.accountId,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  }

  return null;
}
