import { afterEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import {
  applySearchSuggestion,
  getActiveSearchTerm,
  getSearchSuggestions,
  getSearchSuggestionsAt,
  parseAmountNumber,
  parseSearchQuery,
  quoteSearchValue,
  removeTokenFromQuery,
  type SearchSuggestionSources,
} from './search-query-parser';

describe('search-query-parser label support', () => {
  const categories = ['Groceries', 'Income'];
  const labels = ['Vacation', 'Vacation Fund', 'Urgent'];

  it('parses label:<name> as a semantic label filter', () => {
    const parsed = parseSearchQuery('label:Vacation coffee', categories, labels);

    expect(parsed.labelMatches).toEqual(['Vacation']);
    expect(parsed.matchedTokens.some((token) => token.type === 'label')).toBe(true);
    expect(parsed.textQuery).toBe('coffee');
  });

  it('supports quoted label tokens combined with other semantic filters', () => {
    const parsed = parseSearchQuery(
      'last 30 days outflows label:"Vacation Fund" groceries hotel',
      categories,
      labels
    );

    expect(parsed.dateRange).not.toBeNull();
    expect(parsed.transactionType).toBe('outflows');
    expect(parsed.categoryMatches).toEqual(['Groceries']);
    expect(parsed.labelMatches).toEqual(['Vacation Fund']);
    expect(parsed.textQuery).toBe('hotel');
  });

  it('removes label tokens from the original query', () => {
    const query = 'label:Urgent dinner';
    const parsed = parseSearchQuery(query, categories, labels);
    const labelToken = parsed.matchedTokens.find((token) => token.type === 'label');
    if (!labelToken) {
      throw new Error('Expected a label token to be present');
    }

    const next = removeTokenFromQuery(query, labelToken, parsed);
    expect(next).toBe('dinner');
  });
});

describe('week boundaries', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [0, '2023-01-01', '2022-12-25', '2022-12-31'],
    [1, '2022-12-26', '2022-12-19', '2022-12-25'],
  ] as const)(
    'uses week start %s on a Sunday at the year boundary',
    (weekStartsOn, thisStart, lastStart, lastEnd) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2023, 0, 1, 12));
      const current = parseSearchQuery('this week groceries', [], [], weekStartsOn);
      const previous = parseSearchQuery('last week groceries', [], [], weekStartsOn);
      expect(format(current.dateRange!.from, 'yyyy-MM-dd')).toBe(thisStart);
      expect(format(current.dateRange!.to, 'yyyy-MM-dd HH:mm:ss.SSS')).toBe(
        '2023-01-01 23:59:59.999'
      );
      expect(format(previous.dateRange!.from, 'yyyy-MM-dd HH:mm:ss.SSS')).toBe(
        `${lastStart} 00:00:00.000`
      );
      expect(format(previous.dateRange!.to, 'yyyy-MM-dd HH:mm:ss.SSS')).toBe(
        `${lastEnd} 23:59:59.999`
      );
      expect(current.textQuery).toBe('groceries');
      expect(removeTokenFromQuery('this week groceries', current.matchedTokens[0], current)).toBe(
        'groceries'
      );
    }
  );
});

describe('search-query-parser cleared status', () => {
  it.each([
    ['uncleared coffee', 'uncleared'],
    ['is:cleared coffee', 'cleared'],
    ['coffee RECONCILED', 'reconciled'],
  ] as const)('parses %s', (query, status) => {
    const parsed = parseSearchQuery(query, [], []);
    expect(parsed.clearedStatus).toBe(status);
    expect(parsed.textQuery).toBe('coffee');
    expect(parsed.matchedTokens.filter((token) => token.type === 'status')).toHaveLength(1);
  });

  it('removes the status chip from the query', () => {
    const query = 'outflows is:uncleared coffee';
    const parsed = parseSearchQuery(query, [], []);
    const status = parsed.matchedTokens.find((token) => token.type === 'status')!;
    expect(removeTokenFromQuery(query, status, parsed)).toBe('outflows coffee');
  });
});

const day = (d: Date) => format(d, 'yyyy-MM-dd');
const rangeOf = (query: string, options = {}) => {
  const parsed = parseSearchQuery(query, ['Groceries', 'Dining Out', 'May'], ['Trip'], options);
  return parsed.dateRange ? `${day(parsed.dateRange.from)}..${day(parsed.dateRange.to)}` : null;
};

describe('free text', () => {
  it('splits words into independent terms and keeps quoted phrases whole', () => {
    const parsed = parseSearchQuery('coffee "corner shop" downtown', [], []);
    expect(parsed.textTerms.map((term) => [term.value, term.phrase, term.field])).toEqual([
      ['coffee', false, 'any'],
      ['corner shop', true, 'any'],
      ['downtown', false, 'any'],
    ]);
    expect(parsed.textQuery).toBe('coffee "corner shop" downtown');
    expect(parsed.matchedTokens).toEqual([]);
  });

  it('reads an unfinished quote to the end while typing', () => {
    const parsed = parseSearchQuery('"whole fo', [], []);
    expect(parsed.textTerms[0]).toMatchObject({ value: 'whole fo', phrase: true });
  });

  it('never reads quoted words as keywords, dates or amounts', () => {
    const parsed = parseSearchQuery('"uncleared" "march" "2025" "over 100"', [], []);
    expect(parsed.clearedStatus).toBeNull();
    expect(parsed.dateRange).toBeNull();
    expect(parsed.amountFilters).toEqual([]);
    expect(parsed.textTerms.map((term) => term.value)).toEqual([
      'uncleared',
      'march',
      '2025',
      'over 100',
    ]);
  });

  it('keeps a quoted category name a category', () => {
    const parsed = parseSearchQuery('"dining out"', ['Dining Out'], []);
    expect(parsed.categoryMatches).toEqual(['Dining Out']);
    expect(parsed.textTerms).toEqual([]);
  });

  it('keeps unknown prefixes, times and lone numbers as text', () => {
    const parsed = parseSearchQuery('re:invoice 12:30 42.50', [], []);
    expect(parsed.textTerms.map((term) => term.value)).toEqual(['re:invoice', '12:30', '42.50']);
    expect(parsed.amountFilters).toEqual([]);
  });

  it('ignores a field prefix that has no value yet', () => {
    const parsed = parseSearchQuery('coffee payee:', [], []);
    expect(parsed.textTerms.map((term) => term.value)).toEqual(['coffee']);
  });
});

describe('field prefixes', () => {
  it.each([
    ['payee:amazon', 'payee', 'amazon'],
    ['memo:"gift for mom"', 'memo', 'gift for mom'],
    ["account:'Main Checking'", 'account', 'main checking'],
    ['category:groc', 'category', 'groc'],
    ['label:unknown', 'label', 'unknown'],
    ['PAYEE:Shell', 'payee', 'shell'],
  ] as const)('%s searches one field', (query, field, value) => {
    const parsed = parseSearchQuery(query, ['Groceries'], ['Trip']);
    expect(parsed.textTerms).toEqual([expect.objectContaining({ field, value, negated: false })]);
    expect(parsed.matchedTokens).toHaveLength(1);
    expect(parsed.matchedTokens[0].type).toBe('text');
    expect(parsed.textQuery).toBe('');
  });

  it('turns category: and label: with a known name into exact filters', () => {
    const parsed = parseSearchQuery('category:"dining out" label:trip', ['Dining Out'], ['Trip']);
    expect(parsed.categoryMatches).toEqual(['Dining Out']);
    expect(parsed.labelMatches).toEqual(['Trip']);
    expect(parsed.textTerms).toEqual([]);
  });

  it('labels field chips', () => {
    const parsed = parseSearchQuery('payee:amazon', [], []);
    expect(parsed.matchedTokens[0].label).toBe('Payee: “amazon”');
  });
});

describe('negation', () => {
  it('negates words, phrases and fields with a minus', () => {
    const parsed = parseSearchQuery('-coffee -"gift card" -payee:amazon -memo:refund', [], []);
    expect(parsed.textTerms.map((term) => [term.field, term.value, term.negated])).toEqual([
      ['any', 'coffee', true],
      ['any', 'gift card', true],
      ['payee', 'amazon', true],
      ['memo', 'refund', true],
    ]);
    expect(parsed.textQuery).toBe('');
    expect(parsed.matchedTokens.every((token) => token.negated)).toBe(true);
    expect(parsed.matchedTokens[0].label).toBe('Without “coffee”');
  });

  it('negates categories and labels', () => {
    const parsed = parseSearchQuery(
      '-groceries -category:"dining out" -label:trip',
      ['Groceries', 'Dining Out'],
      ['Trip']
    );
    expect(parsed.excludedCategories).toEqual(['Groceries', 'Dining Out']);
    expect(parsed.excludedLabels).toEqual(['Trip']);
    expect(parsed.categoryMatches).toEqual([]);
    expect(parsed.labelMatches).toEqual([]);
  });

  it('negates keywords with a minus or with not', () => {
    const parsed = parseSearchQuery('-transfers not uncleared NOT split -is:reconciled', [], []);
    expect(parsed.excludedTransactionTypes).toEqual(['transfers']);
    expect(parsed.excludedStatuses).toEqual(['uncleared', 'reconciled']);
    expect(parsed.states).toEqual([{ state: 'split', negated: true }]);
    expect(parsed.transactionType).toBeNull();
    expect(parsed.clearedStatus).toBeNull();
    expect(parsed.matchedTokens.map((token) => token.label)).toEqual([
      'Not Transfers',
      'Not Uncleared',
      'Not split',
      'Not Reconciled',
    ]);
  });

  it('not negates a category, label or word', () => {
    const parsed = parseSearchQuery(
      'not groceries not label:trip not coffee',
      ['Groceries'],
      ['Trip']
    );
    expect(parsed.excludedCategories).toEqual(['Groceries']);
    expect(parsed.excludedLabels).toEqual(['Trip']);
    expect(parsed.textTerms).toEqual([expect.objectContaining({ value: 'coffee', negated: true })]);
  });

  it('keeps "not" as a word before a date, an amount or at the end', () => {
    expect(parseSearchQuery('not last month', [], []).textTerms.map((t) => t.value)).toEqual([
      'not',
    ]);
    expect(parseSearchQuery('not over 5', [], []).amountFilters).toHaveLength(1);
    expect(parseSearchQuery('coffee not', [], []).textQuery).toBe('coffee not');
  });

  it('keeps a minus before a number as text', () => {
    const parsed = parseSearchQuery('-5 -', [], []);
    expect(parsed.textTerms.map((term) => [term.value, term.negated])).toEqual([
      ['-5', false],
      ['-', false],
    ]);
  });

  it('removes the whole "not" phrase with its chip', () => {
    const query = 'coffee not uncleared outflows';
    const parsed = parseSearchQuery(query, [], []);
    const chip = parsed.matchedTokens.find((token) => token.type === 'status')!;
    expect(chip.text).toBe('not uncleared');
    expect(removeTokenFromQuery(query, chip, parsed)).toBe('coffee outflows');
  });
});

describe('dates', () => {
  // Wednesday 25 November 2026, noon local time.
  const NOW = new Date(2026, 10, 25, 12);
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  };

  it.each([
    ['today', '2026-11-25..2026-11-25'],
    ['yesterday', '2026-11-24..2026-11-24'],
    ['last month', '2026-10-01..2026-10-31'],
    ['next month', '2026-12-01..2026-12-31'],
    ['next 7 days', '2026-11-25..2026-12-02'],
    ['march', '2026-03-01..2026-03-31'],
    ['Mar', '2026-03-01..2026-03-31'],
    ['sept', '2026-09-01..2026-09-30'],
    ['november', '2026-11-01..2026-11-30'],
    ['december', '2025-12-01..2025-12-31'],
    ['march 2025', '2025-03-01..2025-03-31'],
    ['2025', '2025-01-01..2025-12-31'],
    ['2026-10-01', '2026-10-01..2026-10-01'],
    ['2026-02', '2026-02-01..2026-02-28'],
    ['since 2026-10-01', '2026-10-01..2026-11-25'],
    ['since march', '2026-03-01..2026-11-25'],
    ['after 2026-10-01', '2026-10-02..2026-11-25'],
    ['after october', '2026-11-01..2026-11-25'],
    ['before 2026-10-01', '1970-01-01..2026-09-30'],
    ['before 2025', '1970-01-01..2024-12-31'],
    ['between 2026-01-15 and 2026-02-10', '2026-01-15..2026-02-10'],
    ['between march and may', '2026-03-01..2026-05-31'],
    ['between 2026 and 2024', '2024-01-01..2026-12-31'],
    ['since 2026 before june', '2026-01-01..2026-05-31'],
    ['last year since 2025-06-01', '2025-06-01..2025-12-31'],
    ['upcoming', '2026-11-25..2026-12-25'],
  ])('%s → %s', (query, expected) => {
    at();
    expect(rangeOf(query)).toBe(expected);
  });

  it('leaves invalid dates and other numbers as text', () => {
    at();
    for (const query of ['2026-02-30', '2026-13', '1969', '2100', '12345', 'since', 'mayo']) {
      const parsed = parseSearchQuery(query, [], []);
      expect(parsed.dateRange, query).toBeNull();
      expect(parsed.textTerms.length, query).toBeGreaterThan(0);
    }
  });

  it('reads a month name as a date before a category of the same name', () => {
    at();
    const parsed = parseSearchQuery('may', ['May'], []);
    expect(parsed.dateRange).not.toBeNull();
    expect(parsed.categoryMatches).toEqual([]);
    const quoted = parseSearchQuery('"may"', ['May'], []);
    expect(quoted.dateRange).toBeNull();
    expect(quoted.categoryMatches).toEqual(['May']);
  });

  it('labels date chips and removes them whole', () => {
    at();
    const query = 'coffee between 2026-01-15 and 2026-02-10 outflows';
    const parsed = parseSearchQuery(query, [], []);
    const chip = parsed.matchedTokens.find((token) => token.type === 'date')!;
    expect(chip.text).toBe('between 2026-01-15 and 2026-02-10');
    expect(chip.label).toContain('–');
    expect(removeTokenFromQuery(query, chip, parsed)).toBe('coffee outflows');
    const since = parseSearchQuery('since march 2025', [], []);
    expect(since.matchedTokens[0].label).toBe('Since March 2025');
  });

  it('does not move the range for negated upcoming or when a date is given', () => {
    at();
    expect(rangeOf('not upcoming')).toBeNull();
    expect(rangeOf('upcoming next month')).toBe('2026-12-01..2026-12-31');
  });
});

describe('amounts', () => {
  const amounts = (query: string, decimalSeparator: '.' | ',' = '.') =>
    parseSearchQuery(query, [], [], { decimalSeparator }).amountFilters;

  it.each([
    ['over 100', { operator: 'over', amount: 100 }],
    ['above $20', { operator: 'over', amount: 20 }],
    ['more than 20', { operator: 'over', amount: 20 }],
    ['under 50', { operator: 'under', amount: 50 }],
    ['less than 5', { operator: 'under', amount: 5 }],
    ['exactly 42.50', { operator: 'equal', amount: 42.5 }],
    ['equal to 7', { operator: 'equal', amount: 7 }],
    ['>20', { operator: 'over', amount: 20 }],
    ['> 20', { operator: 'over', amount: 20 }],
    ['<€50', { operator: 'under', amount: 50 }],
    ['=1,250.50', { operator: 'equal', amount: 1250.5 }],
    ['over 100 €', { operator: 'over', amount: 100 }],
    ['over 100€', { operator: 'over', amount: 100 }],
    ['between 20 and 50', { operator: 'between', amount: 20, amountMax: 50 }],
    ['between 50 and 20', { operator: 'between', amount: 20, amountMax: 50 }],
    ['between 2000 and 2500', { operator: 'between', amount: 2000, amountMax: 2500 }],
    ['between $2020 and $2025', { operator: 'between', amount: 2020, amountMax: 2025 }],
    ['over 2025', { operator: 'over', amount: 2025 }],
    ['over 1 000.35', { operator: 'over', amount: 1000.35 }],
    ['=1 250,50', { operator: 'equal', amount: 1250.5 }],
    ['=1.250,50', { operator: 'equal', amount: 1250.5 }],
  ] as const)('%s', (query, expected) => {
    expect(amounts(query)).toEqual([expected]);
  });

  it('reads "between 2020 and 2025" as years', () => {
    const parsed = parseSearchQuery('between 2020 and 2025', [], []);
    expect(parsed.amountFilters).toEqual([]);
    expect(parsed.dateRange).not.toBeNull();
  });

  it('combines several amount filters', () => {
    expect(amounts('over 20 under 50')).toEqual([
      { operator: 'over', amount: 20 },
      { operator: 'under', amount: 50 },
    ]);
  });

  it('removes an amount chip whole', () => {
    const query = 'coffee between 20 and 50 outflows';
    const parsed = parseSearchQuery(query, [], []);
    const chip = parsed.matchedTokens.find((token) => token.type === 'amount')!;
    expect(removeTokenFromQuery(query, chip, parsed)).toBe('coffee outflows');
  });

  it('leaves an operator without a number as text', () => {
    const parsed = parseSearchQuery('over the moon >', [], []);
    expect(parsed.amountFilters).toEqual([]);
    expect(parsed.textQuery).toBe('over the moon >');
  });
});

describe('parseAmountNumber', () => {
  it.each([
    ['42', '.', 42],
    ['42.5', '.', 42.5],
    ['42,5', '.', 42.5],
    ['42,50', ',', 42.5],
    ['1,250.50', '.', 1250.5],
    ['1.250,50', ',', 1250.5],
    ['1.250,50', '.', 1250.5],
    ['1,000', '.', 1000],
    ['1,000', ',', 1],
    ['1.000', ',', 1000],
    ['1.000', '.', 1],
    ['1.000.000', '.', 1000000],
    ['1 000,35', ',', 1000.35],
    ['1\u202f000,35', ',', 1000.35],
    ["1'000.50", '.', 1000.5],
    ['$1,096.56', '.', 1096.56],
    ['1.096,56 $', ',', 1096.56],
    ['.5', '.', 0.5],
  ] as const)('%s with %s decimals → %s', (input, separator, expected) => {
    expect(parseAmountNumber(input, separator)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '1.2.3', '12,34.5,6', '1.', '1,00,000', '--1'])(
    'rejects %s',
    (input) => {
      expect(parseAmountNumber(input, '.')).toBeNull();
    }
  );
});

describe('states', () => {
  it.each([
    ['uncategorized', 'uncategorized', false],
    ['is:uncategorized', 'uncategorized', false],
    ['no:category', 'uncategorized', false],
    ['has:category', 'uncategorized', true],
    ['split', 'split', false],
    ['is:split', 'split', false],
    ['upcoming', 'upcoming', false],
    ['scheduled', 'upcoming', false],
    ['has:memo', 'memo', false],
    ['no:memo', 'memo', true],
    ['-has:memo', 'memo', true],
    ['-no:memo', 'memo', false],
    ['has:label', 'label', false],
    ['no:label', 'label', true],
    ['no:payee', 'payee', true],
  ] as const)('%s', (query, state, negated) => {
    const parsed = parseSearchQuery(query, [], []);
    expect(parsed.states).toEqual([{ state, negated }]);
    expect(parsed.matchedTokens).toHaveLength(1);
    expect(parsed.matchedTokens[0].type).toBe('state');
  });

  it('labels state chips', () => {
    const labels = parseSearchQuery('no:memo has:label uncategorized', [], []).matchedTokens.map(
      (token) => token.label
    );
    expect(labels).toEqual(['No memo', 'Has label', 'Uncategorized']);
  });

  it('keeps an unknown is:/has: value as text', () => {
    const parsed = parseSearchQuery('is:pending has:receipt', [], []);
    expect(parsed.states).toEqual([]);
    expect(parsed.textTerms.map((term) => term.value)).toEqual(['is:pending', 'has:receipt']);
  });

  it('accepts is: for transaction types', () => {
    expect(parseSearchQuery('is:transfer', [], []).transactionType).toBe('transfers');
  });
});

describe('combinations and chip removal', () => {
  const categories = ['Groceries', 'Dining Out'];
  const labels = ['Trip'];
  const query =
    'groceries -payee:amazon "corner shop" last month outflows over 20 label:trip no:memo -coffee';

  it('reads every part', () => {
    const parsed = parseSearchQuery(query, categories, labels);
    expect(parsed.categoryMatches).toEqual(['Groceries']);
    expect(parsed.labelMatches).toEqual(['Trip']);
    expect(parsed.transactionType).toBe('outflows');
    expect(parsed.amountFilters).toEqual([{ operator: 'over', amount: 20 }]);
    expect(parsed.dateLabel).toBe('Last month');
    expect(parsed.states).toEqual([{ state: 'memo', negated: true }]);
    expect(parsed.textQuery).toBe('"corner shop"');
    expect(parsed.textTerms.map((term) => [term.field, term.value, term.negated])).toEqual([
      ['payee', 'amazon', true],
      ['any', 'corner shop', false],
      ['any', 'coffee', true],
    ]);
  });

  it('removes each chip and nothing else', () => {
    const parsed = parseSearchQuery(query, categories, labels);
    const removed = parsed.matchedTokens.map((token) => removeTokenFromQuery(query, token, parsed));
    expect(removed).toEqual([
      '-payee:amazon "corner shop" last month outflows over 20 label:trip no:memo -coffee',
      'groceries "corner shop" last month outflows over 20 label:trip no:memo -coffee',
      'groceries -payee:amazon "corner shop" outflows over 20 label:trip no:memo -coffee',
      'groceries -payee:amazon "corner shop" last month over 20 label:trip no:memo -coffee',
      'groceries -payee:amazon "corner shop" last month outflows label:trip no:memo -coffee',
      'groceries -payee:amazon "corner shop" last month outflows over 20 no:memo -coffee',
      'groceries -payee:amazon "corner shop" last month outflows over 20 label:trip -coffee',
      'groceries -payee:amazon "corner shop" last month outflows over 20 label:trip no:memo',
    ]);
    // Each removal re-parses without the filter that was removed.
    for (const next of removed) {
      expect(parseSearchQuery(next, categories, labels).matchedTokens).toHaveLength(
        parsed.matchedTokens.length - 1
      );
    }
  });

  it('keeps the last positive type and status, like before', () => {
    const parsed = parseSearchQuery('inflows outflows cleared uncleared', [], []);
    expect(parsed.transactionType).toBe('outflows');
    expect(parsed.clearedStatus).toBe('uncleared');
  });

  it('does not repeat a category chip', () => {
    const parsed = parseSearchQuery('groceries Groceries', categories, []);
    expect(parsed.categoryMatches).toEqual(['Groceries']);
    expect(parsed.matchedTokens).toHaveLength(1);
  });
});

describe('chip labels say what the filter does', () => {
  it('names a quoted category phrase as a category, and a negated word as excluded text', () => {
    const parsed = parseSearchQuery('last month -Hrana "Hrana i Pice"', ['Hrana i Pice'], []);
    expect(parsed.matchedTokens.map((token) => [token.type, token.label])).toEqual([
      ['date', 'Last month'],
      ['text', 'Without “Hrana”'],
      ['category', 'Category: “Hrana i Pice”'],
    ]);
    expect(parsed.categoryMatches).toEqual(['Hrana i Pice']);
    expect(parsed.labelMatches).toEqual([]);
  });

  it('tells exact category and label filters from "contains" ones', () => {
    const parsed = parseSearchQuery(
      'category:groc label:tr -category:Rent label:Trip',
      ['Rent'],
      ['Trip']
    );
    expect(parsed.matchedTokens.map((token) => token.label)).toEqual([
      'Category contains “groc”',
      'Label contains “tr”',
      'Not Category: “Rent”',
      'Label: “Trip”',
    ]);
    expect(parsed.matchedTokens.slice(0, 2).map((token) => token.field)).toEqual([
      'category',
      'label',
    ]);
  });
});

describe('suggestions', () => {
  const sources: SearchSuggestionSources = {
    categories: ['Hrana i Piće', 'Hrana', 'Rent', 'Dining Out'],
    labels: ['Trip', 'Hranarina'],
    payees: ['Hranko doo', 'Amazon', 'Mrs "Ana" shop'],
    accounts: ['Yettel EUR', 'Cash'],
  };
  const names = (query: string, caret?: number) =>
    getSearchSuggestions(getActiveSearchTerm(query, caret), sources).map(
      (s) => `${s.kind}:${s.name}`
    );

  it('finds the term at the caret, with its minus, field and open quote', () => {
    expect(getActiveSearchTerm('last month -Hra')).toMatchObject({
      start: 11,
      end: 15,
      negated: true,
      excludes: true,
      field: null,
      value: 'Hra',
    });
    expect(getActiveSearchTerm('-category:"Hrana i P')).toMatchObject({
      negated: true,
      field: 'category',
      value: 'Hrana i P',
      quoted: true,
      closed: false,
    });
    expect(getActiveSearchTerm('-category:')).toMatchObject({ field: 'category', value: '' });
    expect(getActiveSearchTerm('not Hra')).toMatchObject({ negated: false, excludes: true });
    expect(getActiveSearchTerm('coffee ')).toBeNull();
    expect(getActiveSearchTerm('coffee tea', 3)).toMatchObject({ start: 0, end: 6 });
  });

  it('suggests every kind for a bare or negated word, best match first', () => {
    expect(names('Hra')).toEqual([
      'category:Hrana i Piće',
      'category:Hrana',
      'label:Hranarina',
      'payee:Hranko doo',
    ]);
    expect(names('-Hra')).toEqual(names('Hra'));
    expect(names('out')).toEqual(['category:Dining Out']);
    // Accents don't matter: "pice" finds "Piće".
    expect(names('pice')).toEqual(['category:Hrana i Piće']);
    // One letter is not enough without a field.
    expect(names('H')).toEqual([]);
  });

  it('limits a field prefix to its kind and lists names before anything is typed', () => {
    expect(names('-category:')).toEqual([
      'category:Hrana i Piće',
      'category:Hrana',
      'category:Rent',
      'category:Dining Out',
    ]);
    expect(names('label:hr')).toEqual(['label:Hranarina']);
    expect(names('payee:"Hranko')).toEqual(['payee:Hranko doo']);
    expect(names('account:y')).toEqual(['account:Yettel EUR']);
    expect(names('memo:hr')).toEqual([]);
    expect(names('is:spl')).toEqual([]);
  });

  it('suggests inside an open quote', () => {
    expect(names('-"Hrana i')).toEqual(['category:Hrana i Piće']);
  });

  it('hides a name that is already typed out in full', () => {
    expect(names('category:Rent')).toEqual([]);
    expect(names('category:"Hrana"')).toEqual(['category:Hrana i Piće']);
  });

  it('skips dates, amounts and keywords', () => {
    const at = (query: string) =>
      getSearchSuggestionsAt(
        query,
        query.length,
        parseSearchQuery(query, sources.categories, sources.labels),
        { ...sources, categories: ['Monthly bills', 'Overhead', 'Split rent'] }
      ).suggestions;
    expect(at('last month')).toEqual([]);
    expect(at('over 20')).toEqual([]);
    expect(at('split')).toEqual([]);
    expect(at('overh').map((s) => s.name)).toEqual(['Overhead']);
  });

  it('inserts the picked name quoted, with its field and minus', () => {
    const pick = (query: string, kind: 'category' | 'payee' | 'label', name: string) =>
      applySearchSuggestion(query, getActiveSearchTerm(query)!, { kind, name });
    expect(pick('last month -Hra', 'category', 'Hrana i Piće')).toEqual({
      query: 'last month -category:"Hrana i Piće" ',
      caret: 36,
    });
    expect(pick('Hra', 'category', 'Hrana')).toEqual({ query: 'category:Hrana ', caret: 15 });
    expect(pick('-category:"Hrana i', 'category', 'Hrana i Piće').query).toBe(
      '-category:"Hrana i Piće" '
    );
    expect(pick('not amaz', 'payee', 'Amazon').query).toBe('not payee:Amazon ');
    expect(pick('mrs', 'payee', 'Mrs "Ana" shop').query).toBe(`payee:'Mrs "Ana" shop' `);
    // A term in the middle keeps the rest of the query.
    const middle = 'over 20 -Hra outflows';
    expect(
      applySearchSuggestion(middle, getActiveSearchTerm(middle, 12)!, {
        kind: 'category',
        name: 'Hrana i Piće',
      })
    ).toEqual({ query: 'over 20 -category:"Hrana i Piće" outflows', caret: 33 });
  });

  it('parses every inserted suggestion back to the same filter', () => {
    const categories = ['Hrana i Piće'];
    const labels = ['Summer trip'];
    expect(parseSearchQuery('-category:"Hrana i Piće" ', categories, labels)).toMatchObject({
      excludedCategories: ['Hrana i Piće'],
    });
    expect(parseSearchQuery('label:"Summer trip" ', categories, labels)).toMatchObject({
      labelMatches: ['Summer trip'],
    });
    expect(
      parseSearchQuery(`-payee:'Mrs "Ana" shop'`, [], []).textTerms.map((term) => [
        term.field,
        term.value,
        term.negated,
      ])
    ).toEqual([['payee', 'mrs "ana" shop', true]]);
  });

  it('quotes values that would not survive as one word', () => {
    expect(quoteSearchValue('Rent')).toBe('Rent');
    expect(quoteSearchValue('Dining Out')).toBe('"Dining Out"');
    expect(quoteSearchValue('-Minus')).toBe('"-Minus"');
    expect(quoteSearchValue('Say "hi"')).toBe(`'Say "hi"'`);
  });
});
