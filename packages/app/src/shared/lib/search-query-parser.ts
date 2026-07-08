import {
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  subWeeks,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  subYears,
} from 'date-fns';

export interface MatchedToken {
  text: string;
  type: 'date' | 'transactionType' | 'category' | 'label' | 'amount';
  /** For amount tokens, stores the parsed filter data */
  amountFilter?: AmountFilter;
}

export interface AmountFilter {
  operator: 'over' | 'under' | 'equal';
  amount: number;
}

export interface ParsedSearchQuery {
  textQuery: string;
  dateRange: { from: Date; to: Date } | null;
  dateLabel: string | null;
  transactionType: 'inflows' | 'outflows' | 'transfers' | null;
  categoryMatches: string[];
  labelMatches: string[];
  amountFilter: AmountFilter | null;
  matchedTokens: MatchedToken[];
}

const DATE_PATTERNS: {
  pattern: RegExp;
  getRange: (match: RegExpMatchArray) => { from: Date; to: Date };
  getLabel: (match: RegExpMatchArray) => string;
}[] = [
  {
    pattern: /^today$/i,
    getRange: () => {
      const today = new Date();
      return { from: startOfDay(today), to: endOfDay(today) };
    },
    getLabel: () => 'Today',
  },
  {
    pattern: /^yesterday$/i,
    getRange: () => {
      const yesterday = subDays(new Date(), 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
    getLabel: () => 'Yesterday',
  },
  {
    pattern: /^this\s*week$/i,
    getRange: () => {
      const today = new Date();
      return { from: startOfWeek(today, { weekStartsOn: 1 }), to: endOfDay(today) };
    },
    getLabel: () => 'This week',
  },
  {
    pattern: /^last\s*week$/i,
    getRange: () => {
      const lastWeek = subWeeks(new Date(), 1);
      return {
        from: startOfWeek(lastWeek, { weekStartsOn: 1 }),
        to: endOfWeek(lastWeek, { weekStartsOn: 1 }),
      };
    },
    getLabel: () => 'Last week',
  },
  {
    pattern: /^this\s*month$/i,
    getRange: () => {
      const today = new Date();
      return { from: startOfMonth(today), to: endOfDay(today) };
    },
    getLabel: () => 'This month',
  },
  {
    pattern: /^last\s*month$/i,
    getRange: () => {
      const lastMonth = subMonths(new Date(), 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
    getLabel: () => 'Last month',
  },
  {
    pattern: /^this\s*year$/i,
    getRange: () => {
      const today = new Date();
      return { from: startOfYear(today), to: endOfDay(today) };
    },
    getLabel: () => 'This year',
  },
  {
    pattern: /^last\s*year$/i,
    getRange: () => {
      const lastYear = subYears(new Date(), 1);
      return { from: startOfYear(lastYear), to: endOfYear(lastYear) };
    },
    getLabel: () => 'Last year',
  },
  {
    pattern: /^last\s*(\d+)\s*days?$/i,
    getRange: (match) => {
      const days = parseInt(match[1], 10);
      const today = new Date();
      return { from: startOfDay(subDays(today, days)), to: endOfDay(today) };
    },
    getLabel: (match) => {
      const days = parseInt(match[1], 10);
      return `Last ${days} day${days === 1 ? '' : 's'}`;
    },
  },
];

const TRANSACTION_TYPE_KEYWORDS: {
  keywords: string[];
  type: 'inflows' | 'outflows' | 'transfers';
}[] = [
  { keywords: ['inflows', 'inflow', 'income'], type: 'inflows' },
  { keywords: ['outflows', 'outflow', 'expenses', 'expense', 'spending'], type: 'outflows' },
  { keywords: ['transfers', 'transfer'], type: 'transfers' },
];

/**
 * Tokenizes a query string, respecting quoted strings
 */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const regex = /label:"([^"]+)"|label:'([^']+)'|"([^"]+)"|'([^']+)'|(\S+)/gi;
  let match;

  while ((match = regex.exec(query)) !== null) {
    // Match[1]/[2] are quoted label names, [3]/[4] are quoted values, [5] is unquoted.
    const token = match[1]
      ? `label:${match[1]}`
      : match[2]
        ? `label:${match[2]}`
        : match[3] || match[4] || match[5];
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

/**
 * Try to match consecutive tokens as a date pattern
 * Returns the number of tokens consumed if matched, 0 otherwise
 */
function tryMatchDatePattern(
  tokens: string[],
  startIndex: number
): {
  consumed: number;
  range: { from: Date; to: Date };
  label: string;
  matchedText: string;
} | null {
  for (let length = Math.min(4, tokens.length - startIndex); length >= 1; length--) {
    const candidateTokens = tokens.slice(startIndex, startIndex + length);
    const candidateText = candidateTokens.join(' ');

    for (const { pattern, getRange, getLabel } of DATE_PATTERNS) {
      const match = candidateText.match(pattern);
      if (match) {
        return {
          consumed: length,
          range: getRange(match),
          label: getLabel(match),
          matchedText: candidateText,
        };
      }
    }
  }

  return null;
}

function matchTransactionType(token: string): 'inflows' | 'outflows' | 'transfers' | null {
  const lowerToken = token.toLowerCase();
  for (const { keywords, type } of TRANSACTION_TYPE_KEYWORDS) {
    if (keywords.includes(lowerToken)) {
      return type;
    }
  }
  return null;
}

/**
 * Check if a token exactly matches any category name (case-insensitive)
 */
function matchCategory(token: string, categoryNames: string[]): string | null {
  const lowerToken = token.toLowerCase();

  for (const name of categoryNames) {
    if (name.toLowerCase() === lowerToken) {
      return name;
    }
  }

  return null;
}

function matchLabelToken(token: string, labelNames: string[]): string | null {
  if (!token.toLowerCase().startsWith('label:')) {
    return null;
  }

  const raw = token.slice(token.indexOf(':') + 1).trim();
  if (!raw) return null;

  const lowerRaw = raw.toLowerCase();
  for (const name of labelNames) {
    if (name.toLowerCase() === lowerRaw) {
      return name;
    }
  }

  return raw;
}

/**
 * Try to match consecutive tokens as an amount filter pattern
 * Patterns: "over 20", "under 50", "equal 100", "over $20", ">20", "<50", "=100"
 * Returns the number of tokens consumed if matched, 0 otherwise
 */
function tryMatchAmountPattern(
  tokens: string[],
  startIndex: number
): {
  consumed: number;
  filter: AmountFilter;
  matchedText: string;
} | null {
  // Single token patterns: ">20", "<50", "=100", ">$20", "<$50", "=$100"
  const singleToken = tokens[startIndex];
  const singleMatch = singleToken.match(/^([><])[$€£]?(\d+(?:\.\d+)?)$/);
  if (singleMatch) {
    const operator = singleMatch[1] === '>' ? 'over' : 'under';
    const amount = parseFloat(singleMatch[2]);
    if (!isNaN(amount)) {
      return {
        consumed: 1,
        filter: { operator, amount },
        matchedText: singleToken,
      };
    }
  }

  // Single token pattern for equal: "=100", "=$100"
  const equalSingleMatch = singleToken.match(/^=[$€£]?(\d+(?:\.\d+)?)$/);
  if (equalSingleMatch) {
    const amount = parseFloat(equalSingleMatch[1]);
    if (!isNaN(amount)) {
      return {
        consumed: 1,
        filter: { operator: 'equal', amount },
        matchedText: singleToken,
      };
    }
  }

  // Two token patterns: "over 20", "under $50", "equal 100", "exactly $50"
  if (startIndex + 1 < tokens.length) {
    const first = tokens[startIndex].toLowerCase();
    const second = tokens[startIndex + 1];

    if (first === 'over' || first === 'under' || first === 'above' || first === 'below') {
      const numMatch = second.match(/^[$€£]?(\d+(?:\.\d+)?)$/);
      if (numMatch) {
        const operator = first === 'over' || first === 'above' ? 'over' : 'under';
        const amount = parseFloat(numMatch[1]);
        if (!isNaN(amount)) {
          return {
            consumed: 2,
            filter: { operator, amount },
            matchedText: `${tokens[startIndex]} ${second}`,
          };
        }
      }
    }

    if (first === 'equal' || first === 'equals' || first === 'exactly') {
      const numMatch = second.match(/^[$€£]?(\d+(?:\.\d+)?)$/);
      if (numMatch) {
        const amount = parseFloat(numMatch[1]);
        if (!isNaN(amount)) {
          return {
            consumed: 2,
            filter: { operator: 'equal', amount },
            matchedText: `${tokens[startIndex]} ${second}`,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Get category suggestions based on partial input
 * Returns categories that start with or contain the search term
 */
export function getCategorySuggestions(
  query: string,
  categoryNames: string[],
  maxResults = 5
): string[] {
  const trimmed = query.trim().toLowerCase();

  if (trimmed.length < 2) {
    return [];
  }

  const suggestions: string[] = [];
  const seen = new Set<string>();

  // First: categories that start with the query (higher priority)
  for (const name of categoryNames) {
    if (name.toLowerCase().startsWith(trimmed) && !seen.has(name)) {
      suggestions.push(name);
      seen.add(name);
      if (suggestions.length >= maxResults) return suggestions;
    }
  }

  // Second: categories that contain the query
  for (const name of categoryNames) {
    if (name.toLowerCase().includes(trimmed) && !seen.has(name)) {
      suggestions.push(name);
      seen.add(name);
      if (suggestions.length >= maxResults) return suggestions;
    }
  }

  return suggestions;
}

/**
 * Parse a search query and extract semantic filters
 */
export function parseSearchQuery(
  query: string,
  categoryNames: string[],
  labelNames: string[] = []
): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    textQuery: '',
    dateRange: null,
    dateLabel: null,
    transactionType: null,
    categoryMatches: [],
    labelMatches: [],
    amountFilter: null,
    matchedTokens: [],
  };

  if (!query.trim()) {
    return result;
  }

  const tokens = tokenize(query);
  const remainingTokens: string[] = [];
  const matchedCategories = new Set<string>();
  const matchedLabels = new Set<string>();

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    const dateMatch = tryMatchDatePattern(tokens, i);
    if (dateMatch) {
      // Use last-specified date range (overwrite previous)
      result.dateRange = dateMatch.range;
      result.dateLabel = dateMatch.label;
      result.matchedTokens.push({
        text: dateMatch.matchedText,
        type: 'date',
      });
      i += dateMatch.consumed;
      continue;
    }

    const amountMatch = tryMatchAmountPattern(tokens, i);
    if (amountMatch) {
      // Use last-specified amount filter (overwrite previous)
      result.amountFilter = amountMatch.filter;
      result.matchedTokens.push({
        text: amountMatch.matchedText,
        type: 'amount',
        amountFilter: amountMatch.filter,
      });
      i += amountMatch.consumed;
      continue;
    }

    const txType = matchTransactionType(token);
    if (txType) {
      result.transactionType = txType;
      result.matchedTokens.push({
        text: token,
        type: 'transactionType',
      });
      i++;
      continue;
    }

    const categoryMatch = matchCategory(token, categoryNames);
    if (categoryMatch && !matchedCategories.has(categoryMatch)) {
      matchedCategories.add(categoryMatch);
      result.categoryMatches.push(categoryMatch);
      result.matchedTokens.push({
        text: token,
        type: 'category',
      });
      i++;
      continue;
    }

    const labelMatch = matchLabelToken(token, labelNames);
    if (labelMatch && !matchedLabels.has(labelMatch.toLowerCase())) {
      matchedLabels.add(labelMatch.toLowerCase());
      result.labelMatches.push(labelMatch);
      result.matchedTokens.push({
        text: token,
        type: 'label',
      });
      i++;
      continue;
    }

    remainingTokens.push(token);
    i++;
  }

  result.textQuery = remainingTokens.join(' ');
  return result;
}

/**
 * Remove a specific token from the original query
 */
export function removeTokenFromQuery(
  query: string,
  tokenToRemove: MatchedToken,
  parsed: ParsedSearchQuery
): string {
  const tokens = tokenize(query);
  const resultTokens: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const dateMatch = tryMatchDatePattern(tokens, i);
    if (
      dateMatch &&
      tokenToRemove.type === 'date' &&
      dateMatch.matchedText === tokenToRemove.text
    ) {
      i += dateMatch.consumed;
      continue;
    }

    const amountMatch = tryMatchAmountPattern(tokens, i);
    if (
      amountMatch &&
      tokenToRemove.type === 'amount' &&
      amountMatch.matchedText === tokenToRemove.text
    ) {
      i += amountMatch.consumed;
      continue;
    }

    const token = tokens[i];

    if (tokenToRemove.type === 'label') {
      const candidate = matchLabelToken(token, parsed.labelMatches);
      const target = matchLabelToken(tokenToRemove.text, parsed.labelMatches);
      if (
        candidate &&
        target &&
        candidate.localeCompare(target, undefined, { sensitivity: 'base' }) === 0
      ) {
        i++;
        continue;
      }
    }

    const txType = matchTransactionType(token);
    if (
      txType &&
      tokenToRemove.type === 'transactionType' &&
      token.toLowerCase() === tokenToRemove.text.toLowerCase()
    ) {
      i++;
      continue;
    }

    if (tokenToRemove.type === 'category') {
      const matchedCategory = parsed.categoryMatches.find(
        (cat) =>
          cat.toLowerCase().includes(tokenToRemove.text.toLowerCase()) ||
          tokenToRemove.text.toLowerCase().includes(cat.toLowerCase().substring(0, 3))
      );
      if (matchedCategory && token.toLowerCase() === tokenToRemove.text.toLowerCase()) {
        i++;
        continue;
      }
    }

    resultTokens.push(token);
    i++;
  }

  return resultTokens.join(' ');
}

/**
 * Get display label for transaction type
 */
export function getTransactionTypeLabel(type: 'inflows' | 'outflows' | 'transfers'): string {
  switch (type) {
    case 'inflows':
      return 'Inflows';
    case 'outflows':
      return 'Outflows';
    case 'transfers':
      return 'Transfers';
  }
}

/**
 * Get display label for amount filter
 */
export function getAmountFilterLabel(filter: AmountFilter, formatter?: Intl.NumberFormat): string {
  const formattedAmount = formatter ? formatter.format(filter.amount) : String(filter.amount);
  const operatorLabel =
    filter.operator === 'over' ? 'Over' : filter.operator === 'under' ? 'Under' : 'Exactly';
  return `${operatorLabel} ${formattedAmount}`;
}
