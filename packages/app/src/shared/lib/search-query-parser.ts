import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  isValid,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns';

/*
 * Register search: turns what the user types into structured filters.
 *
 * Grammar (keywords are English, case-insensitive):
 * - words are matched independently (AND) against memo, payee, category, label and account;
 *   "double quotes" match an exact phrase;
 * - field prefixes: payee:, memo:, account:, category:, label: (values may be quoted);
 * - negation: -word, -"phrase", -payee:x, -label:x, -category:x, -uncleared, -transfers,
 *   or `not <term>`;
 * - dates: today, yesterday, this/last/next week|month|year, last/next N days, month names
 *   (march, mar, march 2026), years (2025), ISO days and months (2026-10-01, 2026-10),
 *   since/after/before <date>, between <date> and <date>;
 * - amounts: over/above/under/below/exactly/equal N, >N, <N, =N, between N and M;
 * - states: inflows/outflows/transfers, cleared/uncleared/reconciled, uncategorized, split,
 *   upcoming (scheduled), has:/no: memo|label|payee|category, is:<state>.
 *
 * Quoted text is never read as a keyword, date or amount (a quoted category name still
 * selects that category), which is how a payee called "May" or a memo "2025" is searched.
 *
 * Suggestions (getSearchSuggestions) offer category, label, payee and account names for the
 * term at the caret, also after "-", a field prefix or an open quote; a picked name is
 * inserted as `[-]<field>:"<name>"` (applySearchSuggestion).
 */

export type TransactionTypeFilter = 'inflows' | 'outflows' | 'transfers';
export type ClearedStatusFilter = 'cleared' | 'uncleared' | 'reconciled';
/** Row states: `memo`/`label`/`payee` mean "has one"; negated they mean "has none". */
export type SearchState = 'uncategorized' | 'split' | 'upcoming' | 'memo' | 'label' | 'payee';
export type SearchTextField = 'any' | 'payee' | 'memo' | 'account' | 'category' | 'label';

export interface AmountFilter {
  operator: 'over' | 'under' | 'equal' | 'between';
  /** Decimal amount as typed; the lower bound for `between`. */
  amount: number;
  /** Upper bound for `between` (inclusive). */
  amountMax?: number;
}

export interface TextTerm {
  field: SearchTextField;
  /** Lower-cased value to look for (a substring of the field). */
  value: string;
  negated: boolean;
  /** Typed in double quotes: matched as one exact phrase. */
  phrase: boolean;
  start: number;
  end: number;
}

export interface MatchedToken {
  /** The query text this filter came from. */
  text: string;
  type: 'date' | 'transactionType' | 'category' | 'label' | 'amount' | 'status' | 'state' | 'text';
  /** Chip text (amount chips are labelled by the UI, which knows the currency). */
  label?: string;
  negated?: boolean;
  /** For amount tokens, the parsed filter data. */
  amountFilter?: AmountFilter;
  /** For transactionType tokens. */
  transactionType?: TransactionTypeFilter;
  /** For text tokens: the field searched ('any' = every field). */
  field?: SearchTextField;
  /** Span of the filter in the query, used to remove it. */
  start: number;
  end: number;
}

export interface ParsedSearchQuery {
  /** Free text matched against every field (positive words and phrases), for display. */
  textQuery: string;
  /** Every text condition: free words, phrases, field prefixes, negations. */
  textTerms: TextTerm[];
  dateRange: { from: Date; to: Date } | null;
  dateLabel: string | null;
  transactionType: TransactionTypeFilter | null;
  excludedTransactionTypes: TransactionTypeFilter[];
  /** Categories to show (any of them). */
  categoryMatches: string[];
  excludedCategories: string[];
  /** Labels to show (any of them). */
  labelMatches: string[];
  excludedLabels: string[];
  /** Last amount filter typed (all of `amountFilters` apply). */
  amountFilter: AmountFilter | null;
  amountFilters: AmountFilter[];
  clearedStatus: ClearedStatusFilter | null;
  excludedStatuses: ClearedStatusFilter[];
  states: { state: SearchState; negated: boolean }[];
  matchedTokens: MatchedToken[];
}

export interface SearchParseOptions {
  weekStartsOn?: 0 | 1;
  /** The user's decimal separator (from the number format setting). */
  decimalSeparator?: '.' | ',';
}

/** Lower bound for `before <date>`: the same floor as the date picker's "All time" and older. */
const OPEN_START = new Date(1970, 0, 1);

// ---------------------------------------------------------------------------
// Tokenizer

const FIELDS = new Set(['payee', 'memo', 'account', 'category', 'label', 'is', 'has', 'no']);
type Field = 'payee' | 'memo' | 'account' | 'category' | 'label' | 'is' | 'has' | 'no';

interface Token {
  /** Unquoted value as typed. */
  value: string;
  lower: string;
  quoted: boolean;
  negated: boolean;
  field: Field | null;
  start: number;
  end: number;
}

const TOKEN_BODY = /(?:([A-Za-z]+):)?(?:"([^"]*)(?:"|$)|'([^']*)'(?=\s|$)|(\S+))/y;

interface RawToken {
  /** Unquoted value as typed (empty for a field prefix with nothing after it yet). */
  value: string;
  quoted: boolean;
  /** For quoted values: whether the closing quote was typed. */
  closed: boolean;
  negated: boolean;
  field: Field | null;
  start: number;
  end: number;
}

/** Splits a query into terms, keeping spans; also returns terms still being typed. */
function scanTokens(query: string): RawToken[] {
  const tokens: RawToken[] = [];
  let pos = 0;
  const len = query.length;
  while (pos < len) {
    while (pos < len && /\s/.test(query[pos])) pos++;
    if (pos >= len) break;
    const start = pos;
    let negated = false;
    // "-" negates the next term, unless it starts a number ("-5" stays text).
    if (query[pos] === '-' && pos + 1 < len && !/[\s\d.,]/.test(query[pos + 1])) {
      negated = true;
      pos++;
    }
    TOKEN_BODY.lastIndex = pos;
    const match = TOKEN_BODY.exec(query);
    if (!match) {
      pos++;
      continue;
    }
    const end = pos + match[0].length;
    pos = end;
    const rawField = match[1]?.toLowerCase();
    const quotedValue = match[2] ?? match[3];
    const quoted = quotedValue !== undefined;
    const body = match[1] ? match[0].slice(match[1].length + 1) : match[0];
    const closed = match[3] !== undefined || (match[2] !== undefined && /^".*"$/.test(body));
    let value = quoted ? quotedValue : (match[4] ?? '');
    let field: Field | null = null;
    if (rawField) {
      if (FIELDS.has(rawField)) {
        field = rawField as Field;
      } else {
        // Not a search field ("http:", "re:"): keep the whole thing as text.
        value = query.slice(negated ? start + 1 : start, end);
      }
    }
    if (
      !field &&
      !quoted &&
      /^[a-z]+:$/i.test(value) &&
      FIELDS.has(value.slice(0, -1).toLowerCase())
    ) {
      // "payee:" with nothing after it yet: still being typed.
      field = value.slice(0, -1).toLowerCase() as Field;
      value = '';
    }
    tokens.push({ value, quoted, closed, negated, field, start, end });
  }
  return tokens;
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of scanTokens(query)) {
    const value = raw.value.trim();
    if (!value) continue;
    const { quoted, negated, field, start, end } = raw;
    tokens.push({ value, lower: value.toLowerCase(), quoted, negated, field, start, end });
  }
  return tokens;
}

function isPlain(token: Token | undefined): token is Token {
  return !!token && !token.quoted && !token.negated && !token.field;
}

function plainAt(tokens: Token[], index: number): string | null {
  const token = tokens[index];
  return isPlain(token) ? token.lower : null;
}

// ---------------------------------------------------------------------------
// Dates

interface Period {
  consumed: number;
  from: Date;
  to: Date;
  label: string;
}

interface DateMatch extends Period {
  /** closed: a period; lower/upper: since/after or before, combined with the rest. */
  kind: 'closed' | 'lower' | 'upper';
}

const RELATIVE_PATTERNS: {
  pattern: RegExp;
  getRange: (match: RegExpMatchArray, weekStartsOn: 0 | 1, now: Date) => { from: Date; to: Date };
  getLabel: (match: RegExpMatchArray) => string;
}[] = [
  {
    pattern: /^today$/,
    getRange: (_m, _w, now) => ({ from: startOfDay(now), to: endOfDay(now) }),
    getLabel: () => t`Today`,
  },
  {
    pattern: /^yesterday$/,
    getRange: (_m, _w, now) => {
      const yesterday = subDays(now, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
    getLabel: () => t`Yesterday`,
  },
  {
    pattern: /^tomorrow$/,
    getRange: (_m, _w, now) => {
      const tomorrow = addDays(now, 1);
      return { from: startOfDay(tomorrow), to: endOfDay(tomorrow) };
    },
    getLabel: () => t`Tomorrow`,
  },
  {
    pattern: /^this\s*week$/,
    getRange: (_m, weekStartsOn, now) => ({
      from: startOfWeek(now, { weekStartsOn }),
      to: endOfDay(now),
    }),
    getLabel: () => t`This week`,
  },
  {
    pattern: /^last\s*week$/,
    getRange: (_m, weekStartsOn, now) => {
      const lastWeek = subWeeks(now, 1);
      return {
        from: startOfWeek(lastWeek, { weekStartsOn }),
        to: endOfWeek(lastWeek, { weekStartsOn }),
      };
    },
    getLabel: () => t`Last week`,
  },
  {
    pattern: /^next\s*week$/,
    getRange: (_m, weekStartsOn, now) => {
      const nextWeek = addWeeks(now, 1);
      return {
        from: startOfWeek(nextWeek, { weekStartsOn }),
        to: endOfWeek(nextWeek, { weekStartsOn }),
      };
    },
    getLabel: () => t`Next week`,
  },
  {
    pattern: /^this\s*month$/,
    getRange: (_m, _w, now) => ({ from: startOfMonth(now), to: endOfDay(now) }),
    getLabel: () => t`This month`,
  },
  {
    pattern: /^last\s*month$/,
    getRange: (_m, _w, now) => {
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
    getLabel: () => t`Last month`,
  },
  {
    pattern: /^next\s*month$/,
    getRange: (_m, _w, now) => {
      const nextMonth = addMonths(now, 1);
      return { from: startOfMonth(nextMonth), to: endOfMonth(nextMonth) };
    },
    getLabel: () => t`Next month`,
  },
  {
    pattern: /^this\s*year$/,
    getRange: (_m, _w, now) => ({ from: startOfYear(now), to: endOfDay(now) }),
    getLabel: () => t`This year`,
  },
  {
    pattern: /^last\s*year$/,
    getRange: (_m, _w, now) => {
      const lastYear = subYears(now, 1);
      return { from: startOfYear(lastYear), to: endOfYear(lastYear) };
    },
    getLabel: () => t`Last year`,
  },
  {
    pattern: /^next\s*year$/,
    getRange: (_m, _w, now) => {
      const nextYear = addYears(now, 1);
      return { from: startOfYear(nextYear), to: endOfYear(nextYear) };
    },
    getLabel: () => t`Next year`,
  },
  {
    pattern: /^last\s*(\d+)\s*days?$/,
    getRange: (match, _w, now) => {
      const days = parseInt(match[1], 10);
      return { from: startOfDay(subDays(now, days)), to: endOfDay(now) };
    },
    getLabel: (match) => {
      const days = parseInt(match[1], 10);
      return plural(days, { one: `Last # day`, other: `Last # days` });
    },
  },
  {
    pattern: /^next\s*(\d+)\s*days?$/,
    getRange: (match, _w, now) => {
      const days = parseInt(match[1], 10);
      return { from: startOfDay(now), to: endOfDay(addDays(now, days)) };
    },
    getLabel: (match) => {
      const days = parseInt(match[1], 10);
      return plural(days, { one: `Next # day`, other: `Next # days` });
    },
  },
];

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/** A four-digit year that is read as a date (other numbers stay text). */
const YEAR_RE = /^(19[7-9]\d|20\d\d)$/;
const ISO_DAY_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ISO_MONTH_RE = /^(\d{4})-(\d{1,2})$/;

function monthLabel(date: Date): string {
  return i18n.date(date, { month: 'long', year: 'numeric' });
}

function dayLabel(date: Date): string {
  return i18n.date(date, { dateStyle: 'medium' });
}

function monthPeriod(year: number, month: number, consumed: number): Period {
  const from = new Date(year, month, 1);
  return { consumed, from, to: endOfMonth(from), label: monthLabel(from) };
}

/** One date expression (a day, month, year or relative period) starting at `index`. */
function parsePeriodAt(
  tokens: Token[],
  index: number,
  weekStartsOn: 0 | 1,
  now: Date
): Period | null {
  const first = plainAt(tokens, index);
  if (first === null) return null;

  // Relative periods, up to 4 words ("last 30 days").
  for (let length = Math.min(4, tokens.length - index); length >= 1; length--) {
    const words: string[] = [];
    for (let k = 0; k < length; k++) {
      const word = plainAt(tokens, index + k);
      if (word === null) break;
      words.push(word);
    }
    if (words.length !== length) continue;
    const candidate = words.join(' ');
    for (const { pattern, getRange, getLabel } of RELATIVE_PATTERNS) {
      const match = candidate.match(pattern);
      if (match) {
        return { consumed: length, ...getRange(match, weekStartsOn, now), label: getLabel(match) };
      }
    }
  }

  const isoDay = first.match(ISO_DAY_RE);
  if (isoDay) {
    const day = new Date(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]));
    if (
      isValid(day) &&
      day.getMonth() === Number(isoDay[2]) - 1 &&
      day.getDate() === Number(isoDay[3])
    ) {
      return { consumed: 1, from: startOfDay(day), to: endOfDay(day), label: dayLabel(day) };
    }
    return null;
  }

  const isoMonth = first.match(ISO_MONTH_RE);
  if (isoMonth) {
    const month = Number(isoMonth[2]) - 1;
    return month >= 0 && month <= 11 ? monthPeriod(Number(isoMonth[1]), month, 1) : null;
  }

  if (YEAR_RE.test(first)) {
    const from = new Date(Number(first), 0, 1);
    return { consumed: 1, from, to: endOfYear(from), label: first };
  }

  const month = MONTHS[first];
  if (month !== undefined) {
    const next = plainAt(tokens, index + 1);
    if (next !== null && YEAR_RE.test(next)) {
      return monthPeriod(Number(next), month, 2);
    }
    // A month on its own is the latest one that has started.
    const year = month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    return monthPeriod(year, month, 1);
  }

  return null;
}

/** `since`/`after` run up to today (or to the start date's day, if that is later). */
function upToToday(from: Date, now: Date): Date {
  const today = endOfDay(now);
  return from > today ? endOfDay(from) : today;
}

function tryMatchDate(
  tokens: Token[],
  index: number,
  weekStartsOn: 0 | 1,
  now: Date
): DateMatch | null {
  const first = plainAt(tokens, index);
  if (first === null) return null;

  if (first === 'since' || first === 'after' || first === 'before') {
    const period = parsePeriodAt(tokens, index + 1, weekStartsOn, now);
    if (!period) return null;
    const consumed = period.consumed + 1;
    if (first === 'since') {
      return {
        kind: 'lower',
        consumed,
        from: period.from,
        to: upToToday(period.from, now),
        label: t`Since ${period.label}`,
      };
    }
    if (first === 'after') {
      const from = startOfDay(addDays(period.to, 1));
      return {
        kind: 'lower',
        consumed,
        from,
        to: upToToday(from, now),
        label: t`After ${period.label}`,
      };
    }
    return {
      kind: 'upper',
      consumed,
      from: OPEN_START,
      to: endOfDay(subDays(period.from, 1)),
      label: t`Before ${period.label}`,
    };
  }

  if (first === 'between') {
    const a = parsePeriodAt(tokens, index + 1, weekStartsOn, now);
    if (!a || plainAt(tokens, index + 1 + a.consumed) !== 'and') return null;
    const b = parsePeriodAt(tokens, index + 2 + a.consumed, weekStartsOn, now);
    if (!b) return null;
    const [lo, hi] = a.from <= b.from ? [a, b] : [b, a];
    return {
      kind: 'closed',
      consumed: a.consumed + b.consumed + 2,
      from: lo.from,
      to: hi.to,
      label: `${lo.label} – ${hi.label}`,
    };
  }

  const period = parsePeriodAt(tokens, index, weekStartsOn, now);
  return period ? { kind: 'closed', ...period } : null;
}

// ---------------------------------------------------------------------------
// Amounts

const CURRENCY_EDGES = /^\p{Sc}+|\p{Sc}+$/gu;

/**
 * Parses a typed amount. Accepts a dot or comma decimal, and dot, comma, space or
 * apostrophe thousands. A lone separator followed by exactly three digits is read as the
 * user's own format: a decimal if it is their decimal separator, thousands otherwise.
 */
export function parseAmountNumber(input: string, decimalSeparator: '.' | ',' = '.'): number | null {
  const s = input.replace(/[\s'’]/g, '').replace(CURRENCY_EDGES, '');
  if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s) || /[.,]$/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimal: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = s.split(sep).length - 1;
    if (count === 1) {
      const digitsAfter = s.length - s.indexOf(sep) - 1;
      decimal = digitsAfter === 3 && sep !== decimalSeparator ? null : sep;
    }
  }

  let intPart = s;
  let fracPart = '';
  if (decimal) {
    const at = s.lastIndexOf(decimal);
    intPart = s.slice(0, at);
    fracPart = s.slice(at + 1);
    if (!/^\d+$/.test(fracPart)) return null;
  }
  if (/[.,]/.test(intPart)) {
    // Grouped thousands must be groups of three, all with the same separator.
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(intPart) && !/^\d{1,3}(?:,\d{3})+$/.test(intPart)) {
      return null;
    }
    intPart = intPart.replace(/[.,]/g, '');
  }
  const value = parseFloat(`${intPart || '0'}.${fracPart || '0'}`);
  return Number.isFinite(value) ? value : null;
}

const NUMBERISH = /^\p{Sc}*[\d.,'’]+\p{Sc}*$/u;
const THOUSANDS_GROUP = /^\d{3}(?:[.,]\d+)?\p{Sc}*$/u;

/**
 * Reads a number at `index`, joining space-separated thousands ("1 000,50") and a
 * currency sign typed as its own word ("100 €").
 */
function readNumber(
  tokens: Token[],
  index: number,
  decimalSeparator: '.' | ',',
  firstText?: string
): { value: number; consumed: number } | null {
  const first = firstText ?? plainAt(tokens, index);
  if (first === null || first === undefined || !NUMBERISH.test(first)) return null;
  let text = first;
  let consumed = firstText === undefined ? 1 : 0;
  let next = index + (firstText === undefined ? 1 : 0);
  if (/^\p{Sc}*\d{1,3}$/u.test(first)) {
    for (let word = plainAt(tokens, next); word !== null && THOUSANDS_GROUP.test(word);) {
      text += word;
      consumed++;
      next++;
      word = plainAt(tokens, next);
    }
  }
  const value = parseAmountNumber(text, decimalSeparator);
  if (value === null) return null;
  const currency = plainAt(tokens, next);
  if (currency !== null && /^\p{Sc}+$/u.test(currency)) consumed++;
  return { value, consumed };
}

const OVER_WORDS = new Set(['over', 'above', 'more']);
const UNDER_WORDS = new Set(['under', 'below', 'less']);
const EQUAL_WORDS = new Set(['equal', 'equals', 'exactly']);

function tryMatchAmount(
  tokens: Token[],
  index: number,
  decimalSeparator: '.' | ','
): { consumed: number; filter: AmountFilter } | null {
  const first = plainAt(tokens, index);
  if (first === null) return null;

  // ">20", "<$50", "=42.50", or the symbol on its own: "> 20".
  const symbol = first.match(/^([><=])(.*)$/);
  if (symbol) {
    const operator = symbol[1] === '>' ? 'over' : symbol[1] === '<' ? 'under' : 'equal';
    const number = symbol[2]
      ? readNumber(tokens, index + 1, decimalSeparator, symbol[2])
      : readNumber(tokens, index + 1, decimalSeparator);
    if (!number) return null;
    return { consumed: 1 + number.consumed, filter: { operator, amount: number.value } };
  }

  if (OVER_WORDS.has(first) || UNDER_WORDS.has(first) || EQUAL_WORDS.has(first)) {
    // "more than 20", "less than 20"
    let offset = 1;
    if ((first === 'more' || first === 'less') && plainAt(tokens, index + 1) === 'than') {
      offset = 2;
    } else if (first === 'more' || first === 'less') {
      return null;
    }
    // "equal to 20"
    if (EQUAL_WORDS.has(first) && plainAt(tokens, index + 1) === 'to') offset = 2;
    const number = readNumber(tokens, index + offset, decimalSeparator);
    if (!number) return null;
    const operator = OVER_WORDS.has(first) ? 'over' : UNDER_WORDS.has(first) ? 'under' : 'equal';
    return { consumed: offset + number.consumed, filter: { operator, amount: number.value } };
  }

  if (first === 'between') {
    const a = readNumber(tokens, index + 1, decimalSeparator);
    if (!a || plainAt(tokens, index + 1 + a.consumed) !== 'and') return null;
    const b = readNumber(tokens, index + 2 + a.consumed, decimalSeparator);
    if (!b) return null;
    return {
      consumed: a.consumed + b.consumed + 2,
      filter: {
        operator: 'between',
        amount: Math.min(a.value, b.value),
        amountMax: Math.max(a.value, b.value),
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Keywords

const TRANSACTION_TYPE_KEYWORDS: Record<string, TransactionTypeFilter> = {
  inflows: 'inflows',
  inflow: 'inflows',
  income: 'inflows',
  outflows: 'outflows',
  outflow: 'outflows',
  expenses: 'outflows',
  expense: 'outflows',
  spending: 'outflows',
  transfers: 'transfers',
  transfer: 'transfers',
};

const CLEARED_STATUS_KEYWORDS: Record<string, ClearedStatusFilter> = {
  cleared: 'cleared',
  uncleared: 'uncleared',
  reconciled: 'reconciled',
};

const STATE_KEYWORDS: Record<string, SearchState> = {
  uncategorized: 'uncategorized',
  uncategorised: 'uncategorized',
  split: 'split',
  splits: 'split',
  upcoming: 'upcoming',
  scheduled: 'upcoming',
};

/** has:<x> / no:<x>; `has:category` is "not uncategorized". */
const HAS_KEYWORDS: Record<string, { state: SearchState; hasMeansNegated: boolean }> = {
  memo: { state: 'memo', hasMeansNegated: false },
  memos: { state: 'memo', hasMeansNegated: false },
  label: { state: 'label', hasMeansNegated: false },
  labels: { state: 'label', hasMeansNegated: false },
  payee: { state: 'payee', hasMeansNegated: false },
  category: { state: 'uncategorized', hasMeansNegated: true },
};

/** Display label for a transaction type chip. */
export function getTransactionTypeLabel(type: TransactionTypeFilter): string {
  switch (type) {
    case 'inflows':
      return t`Inflows`;
    case 'outflows':
      return t`Outflows`;
    case 'transfers':
      return t`Transfers`;
  }
}

/** Display label for a cleared-status filter chip. */
export function getClearedStatusLabel(status: ClearedStatusFilter): string {
  switch (status) {
    case 'cleared':
      return t`Cleared`;
    case 'uncleared':
      return t`Uncleared`;
    case 'reconciled':
      return t`Reconciled`;
  }
}

/** Display label for a state chip (negated = the opposite state). */
export function getStateLabel(state: SearchState, negated: boolean): string {
  switch (state) {
    case 'uncategorized':
      return negated ? t`Categorized` : t`Uncategorized`;
    case 'split':
      return negated ? t`Not split` : t`Split`;
    case 'upcoming':
      return negated ? t`Not upcoming` : t`Upcoming`;
    case 'memo':
      return negated ? t`No memo` : t`Has memo`;
    case 'label':
      return negated ? t`No label` : t`Has label`;
    case 'payee':
      return negated ? t`No payee` : t`Has payee`;
  }
}

function negatedLabel(label: string, negated: boolean): string {
  return negated ? t`Not ${label}` : label;
}

/**
 * Chip text for a text filter. `exact` is a known category or label picked by name;
 * otherwise the field only has to contain the value.
 */
function textTermLabel(
  field: SearchTextField,
  value: string,
  negated: boolean,
  exact = false
): string {
  const shown = `“${value}”`;
  // A word or phrase that no field may contain.
  if (field === 'any' && negated) return t`Without ${shown}`;
  let label: string;
  switch (field) {
    case 'payee':
      label = t`Payee: ${shown}`;
      break;
    case 'memo':
      label = t`Memo: ${shown}`;
      break;
    case 'account':
      label = t`Account: ${shown}`;
      break;
    case 'category':
      label = exact ? t`Category: ${shown}` : t`Category contains ${shown}`;
      break;
    case 'label':
      label = exact ? t`Label: ${shown}` : t`Label contains ${shown}`;
      break;
    default:
      label = shown;
  }
  return negatedLabel(label, negated);
}

/** Display label for an amount filter chip. */
export function getAmountFilterLabel(filter: AmountFilter, formatter?: Intl.NumberFormat): string {
  const format = (value: number) => (formatter ? formatter.format(value) : String(value));
  const formattedAmount = format(filter.amount);
  if (filter.operator === 'between') {
    const formattedMax = format(filter.amountMax ?? filter.amount);
    return t`Between ${formattedAmount} and ${formattedMax}`;
  }
  const operatorLabel =
    filter.operator === 'over' ? t`Over` : filter.operator === 'under' ? t`Under` : t`Exactly`;
  return `${operatorLabel} ${formattedAmount}`;
}

// ---------------------------------------------------------------------------
// Parser

function emptyResult(): ParsedSearchQuery {
  return {
    textQuery: '',
    textTerms: [],
    dateRange: null,
    dateLabel: null,
    transactionType: null,
    excludedTransactionTypes: [],
    categoryMatches: [],
    excludedCategories: [],
    labelMatches: [],
    excludedLabels: [],
    amountFilter: null,
    amountFilters: [],
    clearedStatus: null,
    excludedStatuses: [],
    states: [],
    matchedTokens: [],
  };
}

function lookupByName(names: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!map.has(lower)) map.set(lower, name);
  }
  return map;
}

/**
 * Parse a search query into structured filters. The fourth argument is either the first
 * day of the week (legacy) or an options object.
 */
export function parseSearchQuery(
  query: string,
  categoryNames: string[],
  labelNames: string[] = [],
  options: 0 | 1 | SearchParseOptions = 0
): ParsedSearchQuery {
  const result = emptyResult();
  if (!query.trim()) return result;

  const { weekStartsOn = 0, decimalSeparator = '.' } =
    typeof options === 'number' ? { weekStartsOn: options } : options;
  const now = new Date();
  const tokens = tokenize(query);
  const categories = lookupByName(categoryNames);
  const labels = lookupByName(labelNames);
  const seenCategories = new Set<string>();
  const seenLabels = new Set<string>();
  const dates: DateMatch[] = [];

  const span = (from: number, to: number) => ({
    start: from,
    end: to,
    text: query.slice(from, to),
  });

  const addCategory = (name: string, negated: boolean, start: number, end: number): boolean => {
    const key = `${negated ? '-' : '+'}${name.toLowerCase()}`;
    if (seenCategories.has(key)) return true;
    seenCategories.add(key);
    (negated ? result.excludedCategories : result.categoryMatches).push(name);
    result.matchedTokens.push({
      ...span(start, end),
      type: 'category',
      negated,
      label: textTermLabel('category', name, negated, true),
    });
    return true;
  };

  const addLabel = (name: string, negated: boolean, start: number, end: number): boolean => {
    const key = `${negated ? '-' : '+'}${name.toLowerCase()}`;
    if (seenLabels.has(key)) return true;
    seenLabels.add(key);
    (negated ? result.excludedLabels : result.labelMatches).push(name);
    result.matchedTokens.push({
      ...span(start, end),
      type: 'label',
      negated,
      label: textTermLabel('label', name, negated, true),
    });
    return true;
  };

  const addText = (
    field: SearchTextField,
    token: Token,
    negated: boolean,
    start: number,
    value = token.lower
  ) => {
    const term: TextTerm = {
      field,
      value,
      negated,
      phrase: token.quoted,
      start,
      end: token.end,
    };
    result.textTerms.push(term);
    // Plain words show in the "Searching" line; anything narrower gets a chip.
    if (field !== 'any' || negated) {
      result.matchedTokens.push({
        ...span(start, token.end),
        type: 'text',
        field,
        negated,
        label: textTermLabel(field, token.value, negated),
      });
    }
  };

  const addType = (type: TransactionTypeFilter, negated: boolean, start: number, end: number) => {
    if (negated) {
      if (!result.excludedTransactionTypes.includes(type)) {
        result.excludedTransactionTypes.push(type);
      }
    } else {
      result.transactionType = type;
    }
    result.matchedTokens.push({
      ...span(start, end),
      type: 'transactionType',
      transactionType: type,
      negated,
      label: negatedLabel(getTransactionTypeLabel(type), negated),
    });
  };

  const addStatus = (status: ClearedStatusFilter, negated: boolean, start: number, end: number) => {
    if (negated) {
      if (!result.excludedStatuses.includes(status)) result.excludedStatuses.push(status);
    } else {
      result.clearedStatus = status;
    }
    result.matchedTokens.push({
      ...span(start, end),
      type: 'status',
      negated,
      label: negatedLabel(getClearedStatusLabel(status), negated),
    });
  };

  const addState = (state: SearchState, negated: boolean, start: number, end: number) => {
    result.states.push({ state, negated });
    result.matchedTokens.push({
      ...span(start, end),
      type: 'state',
      negated,
      label: getStateLabel(state, negated),
    });
  };

  /** Keyword/field/category/text reading of one token; false if nothing usable. */
  const interpret = (token: Token, negated: boolean, start: number): boolean => {
    const { lower, end } = token;
    switch (token.field) {
      case 'label': {
        const name = labels.get(lower);
        if (name) return addLabel(name, negated, start, end);
        addText('label', token, negated, start);
        return true;
      }
      case 'category': {
        const name = categories.get(lower);
        if (name) return addCategory(name, negated, start, end);
        addText('category', token, negated, start);
        return true;
      }
      case 'payee':
      case 'memo':
      case 'account':
        addText(token.field, token, negated, start);
        return true;
      case 'is': {
        const status = CLEARED_STATUS_KEYWORDS[lower];
        if (status) {
          addStatus(status, negated, start, end);
          return true;
        }
        const state = STATE_KEYWORDS[lower];
        if (state) {
          addState(state, negated, start, end);
          return true;
        }
        const type = TRANSACTION_TYPE_KEYWORDS[lower];
        if (type) {
          addType(type, negated, start, end);
          return true;
        }
        break;
      }
      case 'has':
      case 'no': {
        const has = HAS_KEYWORDS[lower];
        if (has) {
          const wantsNone = token.field === 'no';
          addState(has.state, (negated !== wantsNone) !== has.hasMeansNegated, start, end);
          return true;
        }
        break;
      }
      default:
        break;
    }

    if (token.field) {
      // Unknown is:/has:/no: value: search the text as typed.
      const value = `${token.field}:${token.lower}`;
      addText('any', { ...token, quoted: false }, negated, start, value);
      return true;
    }

    if (!token.quoted) {
      const type = TRANSACTION_TYPE_KEYWORDS[lower];
      if (type) {
        addType(type, negated, start, end);
        return true;
      }
      const status = CLEARED_STATUS_KEYWORDS[lower];
      if (status) {
        addStatus(status, negated, start, end);
        return true;
      }
      const state = STATE_KEYWORDS[lower];
      if (state) {
        addState(state, negated, start, end);
        return true;
      }
    }

    const category = categories.get(lower);
    if (category) return addCategory(category, negated, start, end);

    addText('any', token, negated, start);
    return true;
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (isPlain(token)) {
      const date = tryMatchDate(tokens, i, weekStartsOn, now);
      if (date) {
        dates.push(date);
        result.matchedTokens.push({
          ...span(token.start, tokens[i + date.consumed - 1].end),
          type: 'date',
          label: date.label,
        });
        i += date.consumed;
        continue;
      }

      const amount = tryMatchAmount(tokens, i, decimalSeparator);
      if (amount) {
        result.amountFilters.push(amount.filter);
        result.amountFilter = amount.filter;
        result.matchedTokens.push({
          ...span(token.start, tokens[i + amount.consumed - 1].end),
          type: 'amount',
          amountFilter: amount.filter,
        });
        i += amount.consumed;
        continue;
      }

      // "not <term>" negates the next term; before a date or amount it is just a word.
      const next = tokens[i + 1];
      if (
        token.lower === 'not' &&
        next &&
        !next.negated &&
        !(isPlain(next) && tryMatchDate(tokens, i + 1, weekStartsOn, now)) &&
        !(isPlain(next) && tryMatchAmount(tokens, i + 1, decimalSeparator))
      ) {
        interpret(next, true, token.start);
        i += 2;
        continue;
      }
    }

    interpret(token, token.negated, token.start);
    i++;
  }

  // Dates: the last period wins; since/after/before narrow it (or each other).
  let range: { from: Date; to: Date } | null = null;
  const closed = dates.filter((d) => d.kind === 'closed');
  if (closed.length) {
    const last = closed[closed.length - 1];
    range = { from: last.from, to: last.to };
  }
  for (const date of dates) {
    if (date.kind === 'closed') continue;
    if (!range) {
      range = { from: date.from, to: date.to };
    } else if (date.kind === 'lower') {
      range = { from: date.from > range.from ? date.from : range.from, to: range.to };
    } else {
      range = { from: range.from, to: date.to < range.to ? date.to : range.to };
    }
  }
  // Upcoming rows only load when the range reaches the future: show the next 30 days.
  if (!range && result.states.some((s) => s.state === 'upcoming' && !s.negated)) {
    range = { from: startOfDay(now), to: endOfDay(addDays(now, 30)) };
  }
  result.dateRange = range;
  result.dateLabel = dates.length ? dates[dates.length - 1].label : null;

  result.textQuery = result.textTerms
    .filter((term) => term.field === 'any' && !term.negated)
    .map((term) => query.slice(term.start, term.end))
    .join(' ');

  return result;
}

/** Removes a span from the query, joining what is left with one space. */
function cutSpan(query: string, start: number, end: number): string {
  const before = query.slice(0, start).replace(/\s+$/, '');
  const after = query.slice(end).replace(/^\s+/, '');
  return before && after ? `${before} ${after}` : before + after;
}

/**
 * Remove one filter (a chip) from the query it was parsed from.
 * `_parsed` is kept for callers of the older signature.
 */
export function removeTokenFromQuery(
  query: string,
  tokenToRemove: MatchedToken,
  _parsed?: ParsedSearchQuery
): string {
  if (query.slice(tokenToRemove.start, tokenToRemove.end) !== tokenToRemove.text) {
    // Stale chip: fall back to the first occurrence of its text.
    const at = query.indexOf(tokenToRemove.text);
    if (at < 0) return query;
    return cutSpan(query, at, at + tokenToRemove.text.length);
  }
  return cutSpan(query, tokenToRemove.start, tokenToRemove.end);
}

/**
 * Quote a value for the query when it would not survive as one bare word: spaces, a
 * leading quote or minus. Double quotes are used unless the value contains one.
 */
export function quoteSearchValue(value: string): string {
  if (!/[\s"']|^-/.test(value)) return value;
  return value.includes('"') && !value.includes("'") ? `'${value}'` : `"${value}"`;
}

// ---------------------------------------------------------------------------
// Suggestions

export type SearchSuggestionKind = 'category' | 'label' | 'payee' | 'account';

export interface SearchSuggestion {
  kind: SearchSuggestionKind;
  /** The name as stored (inserted as typed here). */
  name: string;
}

export interface SearchSuggestionSources {
  categories: string[];
  labels: string[];
  payees: string[];
  accounts: string[];
}

/** The term under the caret, which a picked suggestion replaces. */
export interface ActiveSearchTerm {
  /** Span of the whole term, including a leading "-" and a field prefix. */
  start: number;
  end: number;
  negated: boolean;
  field: string | null;
  /** The value typed so far (inside an open quote it may contain spaces). */
  value: string;
  quoted: boolean;
  /** A quoted value whose closing quote is typed. */
  closed: boolean;
  /** The picked name will be excluded ("-" or a "not" before the term). */
  excludes: boolean;
}

const SUGGESTION_KINDS: SearchSuggestionKind[] = ['category', 'label', 'payee', 'account'];

/** Lower case without accents, so "pice" finds "Piće". */
function foldForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss');
}

/**
 * The term the caret is in or right after ("-Hra", "-category:", `label:"Summer tr`), or
 * null when the caret is in the space between terms.
 */
export function getActiveSearchTerm(
  query: string,
  caret: number = query.length
): ActiveSearchTerm | null {
  const tokens = scanTokens(query);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (caret <= token.start) break;
    if (caret > token.end) continue;
    const previous = tokens[index - 1];
    const afterNot =
      !!previous &&
      !previous.quoted &&
      !previous.negated &&
      !previous.field &&
      previous.value.toLowerCase() === 'not';
    return {
      excludes: token.negated || afterNot,
      start: token.start,
      end: token.end,
      negated: token.negated,
      field: token.field,
      value: token.value,
      quoted: token.quoted,
      closed: token.closed,
    };
  }
  return null;
}

/** The text a picked suggestion becomes, e.g. `-category:"Food and Drink"`. */
export function suggestionToken(suggestion: SearchSuggestion, negated: boolean): string {
  return `${negated ? '-' : ''}${suggestion.kind}:${quoteSearchValue(suggestion.name)}`;
}

/**
 * Categories, labels, payees and accounts whose name matches the term being typed.
 * A field prefix (category:, label:, payee:, account:) limits the kinds and lists names
 * even before anything is typed; without one, at least two letters are needed.
 */
export function getSearchSuggestions(
  term: ActiveSearchTerm | null,
  sources: SearchSuggestionSources,
  maxResults = 8
): SearchSuggestion[] {
  if (!term) return [];
  let kinds: SearchSuggestionKind[];
  if (term.field === null) {
    kinds = SUGGESTION_KINDS;
  } else if ((SUGGESTION_KINDS as string[]).includes(term.field)) {
    kinds = [term.field as SearchSuggestionKind];
  } else {
    return [];
  }
  const needle = foldForMatch(term.value.trim());
  if (term.field === null && needle.length < 2) return [];

  const listFor = (kind: SearchSuggestionKind) =>
    kind === 'category'
      ? sources.categories
      : kind === 'label'
        ? sources.labels
        : kind === 'payee'
          ? sources.payees
          : sources.accounts;

  // Rank: name starts with the text, then a word starts with it, then it is anywhere.
  const ranked: { rank: number; kindOrder: number; order: number; suggestion: SearchSuggestion }[] =
    [];
  kinds.forEach((kind, kindOrder) => {
    const seen = new Set<string>();
    listFor(kind).forEach((name, order) => {
      const trimmed = name.trim();
      const folded = foldForMatch(trimmed);
      if (!trimmed || seen.has(folded)) return;
      let rank: number;
      if (folded.startsWith(needle)) rank = 0;
      else if (needle && folded.split(/[\s\-/&,.()]+/).some((w) => w.startsWith(needle))) rank = 1;
      else if (folded.includes(needle)) rank = 2;
      else return;
      seen.add(folded);
      ranked.push({ rank, kindOrder, order, suggestion: { kind, name: trimmed } });
    });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.kindOrder - b.kindOrder || a.order - b.order);

  // Hide a suggestion that is already typed out in full.
  const complete = term.field !== null && (!term.quoted || term.closed);
  return ranked
    .map((entry) => entry.suggestion)
    .filter(
      (suggestion) =>
        !(complete && suggestion.kind === term.field && foldForMatch(suggestion.name) === needle)
    )
    .slice(0, maxResults);
}

/** Suggestions for the term at the caret, unless it was read as a date, amount or state. */
export function getSearchSuggestionsAt(
  query: string,
  caret: number,
  parsed: ParsedSearchQuery,
  sources: SearchSuggestionSources,
  maxResults = 8
): { term: ActiveSearchTerm | null; suggestions: SearchSuggestion[] } {
  const term = getActiveSearchTerm(query, caret);
  if (!term) return { term: null, suggestions: [] };
  const isKeyword = parsed.matchedTokens.some(
    (token) =>
      token.type !== 'text' &&
      token.type !== 'category' &&
      token.type !== 'label' &&
      token.start <= term.start &&
      term.end <= token.end
  );
  if (isKeyword) return { term, suggestions: [] };
  return { term, suggestions: getSearchSuggestions(term, sources, maxResults) };
}

/**
 * Replaces the term being typed with a picked suggestion, quoted and with its field and
 * minus, and puts the caret after it (followed by one space).
 */
export function applySearchSuggestion(
  query: string,
  term: ActiveSearchTerm,
  suggestion: SearchSuggestion
): { query: string; caret: number } {
  const text = suggestionToken(suggestion, term.negated);
  const before = query.slice(0, term.start);
  const after = query.slice(term.end).replace(/^\s+/, '');
  const caret = before.length + text.length + 1;
  return { query: `${before}${text} ${after}`, caret };
}
