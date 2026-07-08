import { describe, it, expect } from 'vitest';
import {
  matchesAutofillConditions,
  computeAutofillSuggestions,
  type AutofillContext,
  type TransactionRule,
} from '../src/services/rules/index.js';

const createBaseRule = (overrides: Partial<TransactionRule> = {}): TransactionRule => ({
  id: 1,
  budgetId: 1,
  name: 'Test Rule',
  description: '',
  mode: 'autofill',
  enabled: true,
  oneTimeConsumed: false,
  runOrder: 1,
  conditions: [],
  actions: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('matchesAutofillConditions', () => {
  it('returns false for non-autofill rules', () => {
    const rule = createBaseRule({ mode: 'continuous' });
    const context: AutofillContext = {
      memo: 'test',
      payee: '',
      amount: null,
      accountId: null,
    };
    expect(matchesAutofillConditions(rule, context)).toBe(false);
  });

  it('returns false for disabled rules', () => {
    const rule = createBaseRule({ enabled: false });
    const context: AutofillContext = {
      memo: 'test',
      payee: '',
      amount: null,
      accountId: null,
    };
    expect(matchesAutofillConditions(rule, context)).toBe(false);
  });

  it('returns false for rules with no conditions', () => {
    const rule = createBaseRule({ conditions: [] });
    const context: AutofillContext = {
      memo: 'test',
      payee: '',
      amount: null,
      accountId: null,
    };
    expect(matchesAutofillConditions(rule, context)).toBe(false);
  });

  describe('memo conditions', () => {
    it('matches memo equals condition (case insensitive)', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'memo', operator: 'equals', value: 'lidl' }],
      });
      const context: AutofillContext = {
        memo: 'LIDL',
        payee: '',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('matches memo contains condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'memo', operator: 'contains', value: 'grocery' }],
      });
      const context: AutofillContext = {
        memo: 'Weekly Grocery Shopping',
        payee: '',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('matches memo regex condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'memo', operator: 'regex', value: 'lidl|aldi' }],
      });
      const context: AutofillContext = {
        memo: 'Lidl Store #123',
        payee: '',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('does not match when memo does not contain value', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'memo', operator: 'contains', value: 'amazon' }],
      });
      const context: AutofillContext = {
        memo: 'Lidl Store',
        payee: '',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(false);
    });
  });

  describe('payee conditions', () => {
    it('matches payee equals condition (case insensitive)', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'payee', operator: 'equals', value: 'amazon' }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: 'Amazon',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('matches payee contains condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'payee', operator: 'contains', value: 'store' }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: 'My Store',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('matches payee regex condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'payee', operator: 'regex', value: 'lidl|aldi' }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: 'ALDI',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });
  });

  describe('amount conditions', () => {
    it('matches amount equals condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'amount', operator: '=', value: 100 }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: '',
        amount: 100,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('matches amount greater than condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'amount', operator: '>', value: 50 }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: '',
        amount: 100,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('does not match when amount is less', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'amount', operator: '>', value: 100 }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: '',
        amount: 50,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(false);
    });

    it('returns false when amount is null', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'amount', operator: '>', value: 100 }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: '',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(false);
    });
  });

  describe('account conditions', () => {
    it('matches account is condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'account', operator: 'is', value: 5 }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: '',
        amount: null,
        accountId: 5,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('matches account is_not condition', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'account', operator: 'is_not', value: 5 }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: '',
        amount: null,
        accountId: 10,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(true);
    });

    it('returns false when accountId is null', () => {
      const rule = createBaseRule({
        conditions: [{ field: 'account', operator: 'is', value: 5 }],
      });
      const context: AutofillContext = {
        memo: '',
        payee: '',
        amount: null,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, context)).toBe(false);
    });
  });

  describe('multiple conditions (AND logic)', () => {
    it('requires all conditions to match', () => {
      const rule = createBaseRule({
        conditions: [
          { field: 'payee', operator: 'contains', value: 'store' },
          { field: 'amount', operator: '>', value: 50 },
        ],
      });

      const matchingContext: AutofillContext = {
        memo: '',
        payee: 'My Store',
        amount: 100,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, matchingContext)).toBe(true);

      const nonMatchingContext: AutofillContext = {
        memo: '',
        payee: 'My Store',
        amount: 25,
        accountId: null,
      };
      expect(matchesAutofillConditions(rule, nonMatchingContext)).toBe(false);
    });
  });
});

describe('computeAutofillSuggestions', () => {
  const groceriesRule = createBaseRule({
    id: 1,
    name: 'Groceries',
    conditions: [{ field: 'payee', operator: 'contains', value: 'lidl' }],
    actions: [{ type: 'category.set', payload: { categoryId: 5 } }],
  });

  const defaultCurrentValues = {
    categoryId: null,
    payee: '',
    memo: '',
    amount: null,
    accountId: null,
  };

  it('suggests category when payee matches and category is empty', () => {
    const context: AutofillContext = {
      memo: '',
      payee: 'Lidl',
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, payee: 'Lidl' };
    const rejectedFields = new Set<string>();

    const suggestions = computeAutofillSuggestions(
      [groceriesRule],
      context,
      currentValues,
      rejectedFields
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      field: 'category',
      value: 5,
      ruleId: 1,
      ruleName: 'Groceries',
    });
  });

  it('does not suggest category when already set', () => {
    const context: AutofillContext = {
      memo: '',
      payee: 'Lidl',
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, categoryId: 10, payee: 'Lidl' };
    const rejectedFields = new Set<string>();

    const suggestions = computeAutofillSuggestions(
      [groceriesRule],
      context,
      currentValues,
      rejectedFields
    );

    expect(suggestions).toHaveLength(0);
  });

  it('does not suggest rejected fields', () => {
    const context: AutofillContext = {
      memo: '',
      payee: 'Lidl',
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, payee: 'Lidl' };
    const rejectedFields = new Set<string>(['category']);

    const suggestions = computeAutofillSuggestions(
      [groceriesRule],
      context,
      currentValues,
      rejectedFields
    );

    expect(suggestions).toHaveLength(0);
  });

  it('suggests payee when rule has payee.set action', () => {
    const payeeRule = createBaseRule({
      id: 2,
      name: 'Set Payee',
      conditions: [{ field: 'memo', operator: 'contains', value: 'amazon' }],
      actions: [{ type: 'payee.set', payload: { payee: 'Amazon.com' } }],
    });

    const context: AutofillContext = {
      memo: 'amazon prime',
      payee: '',
      amount: null,
      accountId: null,
    };
    const currentValues = defaultCurrentValues;
    const rejectedFields = new Set<string>();

    const suggestions = computeAutofillSuggestions(
      [payeeRule],
      context,
      currentValues,
      rejectedFields
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      field: 'payee',
      value: 'Amazon.com',
      ruleId: 2,
      ruleName: 'Set Payee',
    });
  });

  it('respects rule priority (runOrder)', () => {
    const rule1 = createBaseRule({
      id: 1,
      name: 'Rule 1',
      runOrder: 2,
      conditions: [{ field: 'payee', operator: 'contains', value: 'lidl' }],
      actions: [{ type: 'category.set', payload: { categoryId: 10 } }],
    });

    const rule2 = createBaseRule({
      id: 2,
      name: 'Rule 2',
      runOrder: 1,
      conditions: [{ field: 'payee', operator: 'contains', value: 'lidl' }],
      actions: [{ type: 'category.set', payload: { categoryId: 20 } }],
    });

    const context: AutofillContext = {
      memo: '',
      payee: 'Lidl',
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, payee: 'Lidl' };

    const suggestions = computeAutofillSuggestions(
      [rule1, rule2],
      context,
      currentValues,
      new Set()
    );

    // rule2 should win because it has lower runOrder
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].value).toBe(20);
    expect(suggestions[0].ruleName).toBe('Rule 2');
  });

  it('suggests multiple fields from one rule', () => {
    const multiActionRule = createBaseRule({
      id: 1,
      name: 'Multi Action',
      conditions: [{ field: 'memo', operator: 'contains', value: 'grocery' }],
      actions: [
        { type: 'category.set', payload: { categoryId: 5 } },
        { type: 'payee.set', payload: { payee: 'Local Grocery' } },
      ],
    });

    const context: AutofillContext = {
      memo: 'grocery shopping',
      payee: '',
      amount: null,
      accountId: null,
    };
    const currentValues = defaultCurrentValues;

    const suggestions = computeAutofillSuggestions(
      [multiActionRule],
      context,
      currentValues,
      new Set()
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((s) => s.field)).toContain('category');
    expect(suggestions.map((s) => s.field)).toContain('payee');
  });

  it('does not suggest when conditions do not match', () => {
    const context: AutofillContext = {
      memo: '',
      payee: 'Aldi', // Different payee
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, payee: 'Aldi' };

    const suggestions = computeAutofillSuggestions(
      [groceriesRule],
      context,
      currentValues,
      new Set()
    );

    expect(suggestions).toHaveLength(0);
  });

  it('suggests memo when rule has memo.set action', () => {
    const memoRule = createBaseRule({
      id: 3,
      name: 'Set Memo',
      conditions: [{ field: 'payee', operator: 'contains', value: 'walmart' }],
      actions: [{ type: 'memo.set', payload: { memo: 'Groceries at Walmart' } }],
    });

    const context: AutofillContext = {
      memo: '',
      payee: 'Walmart',
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, payee: 'Walmart' };
    const rejectedFields = new Set<string>();

    const suggestions = computeAutofillSuggestions(
      [memoRule],
      context,
      currentValues,
      rejectedFields
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      field: 'memo',
      value: 'Groceries at Walmart',
      ruleId: 3,
      ruleName: 'Set Memo',
    });
  });

  it('does not suggest memo when memo is already set', () => {
    const memoRule = createBaseRule({
      id: 3,
      name: 'Set Memo',
      conditions: [{ field: 'payee', operator: 'contains', value: 'walmart' }],
      actions: [{ type: 'memo.set', payload: { memo: 'Groceries at Walmart' } }],
    });

    const context: AutofillContext = {
      memo: 'Existing memo',
      payee: 'Walmart',
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, payee: 'Walmart', memo: 'Existing memo' };

    const suggestions = computeAutofillSuggestions([memoRule], context, currentValues, new Set());

    expect(suggestions).toHaveLength(0);
  });

  it('suggests account when rule has account.set action', () => {
    const accountRule = createBaseRule({
      id: 4,
      name: 'Set Account',
      conditions: [{ field: 'memo', operator: 'contains', value: 'salary' }],
      actions: [{ type: 'account.set', payload: { accountId: 10 } }],
    });

    const context: AutofillContext = {
      memo: 'Monthly salary',
      payee: '',
      amount: null,
      accountId: null,
    };
    const currentValues = defaultCurrentValues;
    const rejectedFields = new Set<string>();

    const suggestions = computeAutofillSuggestions(
      [accountRule],
      context,
      currentValues,
      rejectedFields
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      field: 'account',
      value: 10,
      ruleId: 4,
      ruleName: 'Set Account',
    });
  });

  it('does not suggest account when account is already set', () => {
    const accountRule = createBaseRule({
      id: 4,
      name: 'Set Account',
      conditions: [{ field: 'memo', operator: 'contains', value: 'salary' }],
      actions: [{ type: 'account.set', payload: { accountId: 10 } }],
    });

    const context: AutofillContext = {
      memo: 'Monthly salary',
      payee: '',
      amount: null,
      accountId: 5, // Already has an account
    };
    const currentValues = { ...defaultCurrentValues, accountId: 5 };

    const suggestions = computeAutofillSuggestions(
      [accountRule],
      context,
      currentValues,
      new Set()
    );

    expect(suggestions).toHaveLength(0);
  });

  it('suggests all fields from shortcode-style rule', () => {
    // Shortcode example: memo contains "GrW" -> set payee, category, memo, account
    const shortcodeRule = createBaseRule({
      id: 5,
      name: 'Grocery Shortcode',
      conditions: [{ field: 'memo', operator: 'contains', value: 'GrW' }],
      actions: [
        { type: 'payee.set', payload: { payee: 'Walmart' } },
        { type: 'category.set', payload: { categoryId: 5 } },
        { type: 'memo.set', payload: { memo: 'Groceries at Walmart' } },
        { type: 'account.set', payload: { accountId: 10 } },
      ],
    });

    const context: AutofillContext = {
      memo: 'GrW',
      payee: '',
      amount: null,
      accountId: null,
    };
    // Note: memo is NOT empty in currentValues - it contains the shortcode
    const currentValues = { ...defaultCurrentValues, memo: 'GrW' };

    const suggestions = computeAutofillSuggestions(
      [shortcodeRule],
      context,
      currentValues,
      new Set()
    );

    // Should still suggest memo because memo was used as a condition (shortcode pattern)
    expect(suggestions).toHaveLength(4);
    expect(suggestions.map((s) => s.field).sort()).toEqual([
      'account',
      'category',
      'memo',
      'payee',
    ]);

    // Verify the memo suggestion has the correct value
    const memoSuggestion = suggestions.find((s) => s.field === 'memo');
    expect(memoSuggestion?.value).toBe('Groceries at Walmart');
  });

  it('overwrites memo when memo condition triggered the rule', () => {
    const memoShortcodeRule = createBaseRule({
      id: 6,
      name: 'Memo Shortcode',
      conditions: [{ field: 'memo', operator: 'contains', value: 'GW' }],
      actions: [{ type: 'memo.set', payload: { memo: 'Groceries at Walmart' } }],
    });

    const context: AutofillContext = {
      memo: 'GW',
      payee: '',
      amount: null,
      accountId: null,
    };
    // Memo already has content (the shortcode)
    const currentValues = { ...defaultCurrentValues, memo: 'GW' };

    const suggestions = computeAutofillSuggestions(
      [memoShortcodeRule],
      context,
      currentValues,
      new Set()
    );

    // Should suggest memo overwrite because memo was used as a condition
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].field).toBe('memo');
    expect(suggestions[0].value).toBe('Groceries at Walmart');
  });

  it('does NOT overwrite memo when memo was NOT a condition', () => {
    // Rule triggers on payee but has memo.set action
    const payeeTriggerRule = createBaseRule({
      id: 7,
      name: 'Payee Trigger',
      conditions: [{ field: 'payee', operator: 'contains', value: 'walmart' }],
      actions: [{ type: 'memo.set', payload: { memo: 'Groceries at Walmart' } }],
    });

    const context: AutofillContext = {
      memo: 'Existing memo text',
      payee: 'Walmart Store',
      amount: null,
      accountId: null,
    };
    // Memo already has content but NOT used as condition
    const currentValues = {
      ...defaultCurrentValues,
      memo: 'Existing memo text',
      payee: 'Walmart Store',
    };

    const suggestions = computeAutofillSuggestions(
      [payeeTriggerRule],
      context,
      currentValues,
      new Set()
    );

    // Should NOT suggest memo because memo has content and wasn't used as condition
    expect(suggestions).toHaveLength(0);
  });

  it('overwrites payee when payee condition triggered the rule', () => {
    const payeeShortcodeRule = createBaseRule({
      id: 8,
      name: 'Payee Shortcode',
      conditions: [{ field: 'payee', operator: 'contains', value: 'WM' }],
      actions: [{ type: 'payee.set', payload: { payee: 'Walmart' } }],
    });

    const context: AutofillContext = {
      memo: '',
      payee: 'WM',
      amount: null,
      accountId: null,
    };
    const currentValues = { ...defaultCurrentValues, payee: 'WM' };

    const suggestions = computeAutofillSuggestions(
      [payeeShortcodeRule],
      context,
      currentValues,
      new Set()
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].field).toBe('payee');
    expect(suggestions[0].value).toBe('Walmart');
  });
});
