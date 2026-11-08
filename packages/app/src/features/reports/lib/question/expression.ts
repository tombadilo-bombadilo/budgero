/**
 * The notebook's custom expression language: custom columns (row level) and
 * custom metrics (aggregated), e.g.
 *
 *   abs([Amount])
 *   SumIf([Outflow], [Category] = "Groceries") / Sum([Outflow]) * 100
 *   Spending / Income * 100
 *
 * Text → tokens → AST (with positions) → type check → SQL. User text never
 * reaches SQL: field refs map to known columns through the caller's env,
 * numbers are re-printed from parsed values, strings become escaped literals,
 * and every function / operator comes from the fixed tables below.
 *
 * Saved specs store the canonical form (field ids in brackets, English
 * function names), so a question opens in any UI language.
 */

export type ExprValueType = 'number' | 'string' | 'boolean' | 'date';
export type ExprLevel = 'row' | 'metric';
/** Budget metrics usable by name in custom metrics (Transactions only). */
export type ExprMetricName = 'spending' | 'income' | 'net' | 'count';

export interface ExprField {
  /** Field id (or custom column id) stored in the canonical text. */
  id: string;
  type: ExprValueType;
  /** Money-valued numbers (formats results as currency). */
  money?: boolean;
  /** Extra names the field can be written as (labels), matched case-insensitively. */
  names?: readonly string[];
}

export interface ExprEnv {
  fields: readonly ExprField[];
  level: ExprLevel;
  /** Allow Spending / Income / Net as metric names (Transactions source). */
  budgetMetrics?: boolean;
  /** Extra (localized) names for the metric names, e.g. { Ausgaben: 'spending' }. */
  metricNames?: Readonly<Record<string, ExprMetricName>>;
}

export const MAX_EXPRESSION_LENGTH = 1000;
const MAX_DEPTH = 40;
const MAX_TOKENS = 400;

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type ExprBinaryOp =
  '+' | '-' | '*' | '/' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or';

export type ExprFunction =
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count'
  | 'countif'
  | 'sumif'
  | 'distinct'
  | 'abs'
  | 'round'
  | 'coalesce'
  | 'case'
  | 'contains';

interface Span {
  start: number;
  end: number;
}

export type ExprNode =
  | ({ kind: 'number'; value: number } & Span)
  | ({ kind: 'string'; value: string } & Span)
  | ({ kind: 'boolean'; value: boolean } & Span)
  | ({ kind: 'field'; id: string } & Span)
  | ({ kind: 'metric'; name: ExprMetricName } & Span)
  | ({ kind: 'negate'; arg: ExprNode } & Span)
  | ({ kind: 'not'; arg: ExprNode } & Span)
  | ({ kind: 'binary'; op: ExprBinaryOp; left: ExprNode; right: ExprNode } & Span)
  | ({ kind: 'call'; fn: ExprFunction; args: ExprNode[] } & Span);

interface FunctionDef {
  canonical: string;
  aggregate: boolean;
  minArgs: number;
  maxArgs: number;
}

const FUNCTIONS: Record<ExprFunction, FunctionDef> = {
  sum: { canonical: 'Sum', aggregate: true, minArgs: 1, maxArgs: 1 },
  avg: { canonical: 'Avg', aggregate: true, minArgs: 1, maxArgs: 1 },
  min: { canonical: 'Min', aggregate: true, minArgs: 1, maxArgs: 1 },
  max: { canonical: 'Max', aggregate: true, minArgs: 1, maxArgs: 1 },
  count: { canonical: 'Count', aggregate: true, minArgs: 0, maxArgs: 0 },
  countif: { canonical: 'CountIf', aggregate: true, minArgs: 1, maxArgs: 1 },
  sumif: { canonical: 'SumIf', aggregate: true, minArgs: 2, maxArgs: 2 },
  distinct: { canonical: 'Distinct', aggregate: true, minArgs: 1, maxArgs: 1 },
  abs: { canonical: 'abs', aggregate: false, minArgs: 1, maxArgs: 1 },
  round: { canonical: 'round', aggregate: false, minArgs: 1, maxArgs: 2 },
  coalesce: { canonical: 'coalesce', aggregate: false, minArgs: 2, maxArgs: 8 },
  case: { canonical: 'case', aggregate: false, minArgs: 2, maxArgs: 41 },
  contains: { canonical: 'contains', aggregate: false, minArgs: 2, maxArgs: 2 },
};

const FUNCTION_ALIASES: Record<string, ExprFunction> = {
  average: 'avg',
  if: 'case',
};

const METRIC_CANONICAL: Record<ExprMetricName, string> = {
  spending: 'Spending',
  income: 'Income',
  net: 'Net',
  count: 'Count',
};

/** Function names offered by the editor's autocomplete, in canonical spelling. */
export function expressionFunctionNames(level: ExprLevel): string[] {
  return (Object.keys(FUNCTIONS) as ExprFunction[])
    .filter((fn) => level === 'metric' || !FUNCTIONS[fn].aggregate)
    .map((fn) => FUNCTIONS[fn].canonical);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ExprErrorCode =
  | 'empty'
  | 'tooLong'
  | 'tooComplex'
  | 'unexpectedCharacter'
  | 'unterminatedString'
  | 'unterminatedField'
  | 'emptyField'
  | 'unknownField'
  | 'unknownName'
  | 'unknownFunction'
  | 'unexpectedToken'
  | 'unexpectedEnd'
  | 'missingParen'
  | 'argumentCount'
  | 'expectedNumber'
  | 'expectedBoolean'
  | 'expectedText'
  | 'typeMismatch'
  | 'invalidDate'
  | 'aggregateInColumn'
  | 'metricInColumn'
  | 'nestedAggregate'
  | 'fieldOutsideAggregate'
  | 'needsAggregate'
  | 'metricUnavailable'
  | 'metricResultNotNumber'
  | 'columnResultDate'
  | 'roundDigits';

export class ExpressionError extends Error {
  readonly code: ExprErrorCode;

  /** Character offsets of the problem in the source text. */
  readonly start: number;

  readonly end: number;

  /** Detail for the message, e.g. the unknown name or function. */
  readonly detail: string;

  constructor(code: ExprErrorCode, start: number, end: number, detail = '') {
    super(`${defaultErrorMessage(code, detail)} (at ${start + 1})`);
    this.name = 'ExpressionError';
    this.code = code;
    this.start = start;
    this.end = Math.max(end, start);
    this.detail = detail;
  }
}

function defaultErrorMessage(code: ExprErrorCode, detail: string): string {
  switch (code) {
    case 'empty':
      return 'Enter an expression';
    case 'tooLong':
      return 'The expression is too long';
    case 'tooComplex':
      return 'The expression is nested too deeply';
    case 'unexpectedCharacter':
      return `Unexpected character ${detail}`;
    case 'unterminatedString':
      return 'Text is missing its closing quote';
    case 'unterminatedField':
      return 'A field name is missing its closing ]';
    case 'emptyField':
      return 'Empty field name []';
    case 'unknownField':
      return `Unknown field [${detail}]`;
    case 'unknownName':
      return `Unknown name ${detail}`;
    case 'unknownFunction':
      return `Unknown function ${detail}`;
    case 'unexpectedToken':
      return `Unexpected ${detail}`;
    case 'unexpectedEnd':
      return 'The expression ends too early';
    case 'missingParen':
      return 'Missing )';
    case 'argumentCount':
      return `Wrong number of arguments for ${detail}`;
    case 'expectedNumber':
      return 'Expected a number here';
    case 'expectedBoolean':
      return 'Expected a condition here';
    case 'expectedText':
      return 'Expected text here';
    case 'typeMismatch':
      return 'These values can’t be compared or combined';
    case 'invalidDate':
      return 'Dates are written as "YYYY-MM-DD"';
    case 'aggregateInColumn':
      return `${detail} can only be used in a custom metric`;
    case 'metricInColumn':
      return `${detail} can only be used in a custom metric`;
    case 'nestedAggregate':
      return `${detail} can’t be used inside another aggregation`;
    case 'fieldOutsideAggregate':
      return `[${detail}] must be inside an aggregation like Sum([${detail}])`;
    case 'needsAggregate':
      return 'A custom metric needs an aggregation like Sum([Amount]) or Count';
    case 'metricUnavailable':
      return `${detail} is only available for transactions`;
    case 'metricResultNotNumber':
      return 'A custom metric must be a number';
    case 'columnResultDate':
      return 'A custom column must be a number, text or a condition';
    case 'roundDigits':
      return 'round() takes a whole number of digits from −10 to 10';
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind = 'number' | 'string' | 'field' | 'ident' | 'op' | '(' | ')' | ',' | 'eof';

interface Token extends Span {
  kind: TokenKind;
  /** Number source, string value, field name, identifier, or operator. */
  text: string;
}

const OPERATORS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '×': '*',
  '/': '/',
  '÷': '/',
  '=': '=',
  '==': '=',
  '!=': '!=',
  '<>': '!=',
  '≠': '!=',
  '<': '<',
  '<=': '<=',
  '≤': '<=',
  '>': '>',
  '>=': '>=',
  '≥': '>=',
};

function isIdentStart(char: string): boolean {
  return /[\p{L}_]/u.test(char);
}

function isIdentPart(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char);
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const start = index;
    if (tokens.length >= MAX_TOKENS) throw new ExpressionError('tooComplex', start, text.length);

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[index + 1] ?? ''))) {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(index));
      const source = match ? match[0] : char;
      index += source.length;
      if (isIdentPart(text[index] ?? '')) {
        throw new ExpressionError('unexpectedCharacter', index, index + 1, text[index]);
      }
      tokens.push({ kind: 'number', text: source, start, end: index });
      continue;
    }

    if (char === '"' || char === "'") {
      let value = '';
      index += 1;
      let closed = false;
      while (index < text.length) {
        const next = text[index];
        if (next === '\\' && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        if (next === char) {
          closed = true;
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      if (!closed) throw new ExpressionError('unterminatedString', start, text.length);
      tokens.push({ kind: 'string', text: value, start, end: index });
      continue;
    }

    if (char === '[') {
      const close = text.indexOf(']', index + 1);
      const open = text.indexOf('[', index + 1);
      if (close === -1 || (open !== -1 && open < close)) {
        throw new ExpressionError('unterminatedField', start, open !== -1 ? open : text.length);
      }
      const name = text.slice(index + 1, close).trim();
      index = close + 1;
      if (!name) throw new ExpressionError('emptyField', start, index);
      tokens.push({ kind: 'field', text: name, start, end: index });
      continue;
    }

    if (isIdentStart(char)) {
      let end = index + 1;
      while (end < text.length && isIdentPart(text[end])) end += 1;
      tokens.push({ kind: 'ident', text: text.slice(index, end), start, end });
      index = end;
      continue;
    }

    if (char === '(' || char === ')' || char === ',') {
      tokens.push({ kind: char, text: char, start, end: index + 1 });
      index += 1;
      continue;
    }

    const two = text.slice(index, index + 2);
    if (OPERATORS[two] && two.length === 2) {
      tokens.push({ kind: 'op', text: OPERATORS[two], start, end: index + 2 });
      index += 2;
      continue;
    }
    if (OPERATORS[char]) {
      tokens.push({ kind: 'op', text: OPERATORS[char], start, end: index + 1 });
      index += 1;
      continue;
    }
    throw new ExpressionError('unexpectedCharacter', start, start + 1, char);
  }
  tokens.push({ kind: 'eof', text: '', start: text.length, end: text.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

class Parser {
  private position = 0;

  private depth = 0;

  private readonly fieldsByName = new Map<string, ExprField>();

  private readonly metricsByName = new Map<string, ExprMetricName>();

  constructor(
    private readonly tokens: Token[],
    env: ExprEnv
  ) {
    // Ids win over labels; earlier fields win over later ones.
    for (const field of env.fields) {
      const key = normalizeName(field.id);
      if (!this.fieldsByName.has(key)) this.fieldsByName.set(key, field);
    }
    for (const field of env.fields) {
      for (const name of field.names ?? []) {
        const key = normalizeName(name);
        if (key && !this.fieldsByName.has(key)) this.fieldsByName.set(key, field);
      }
    }
    for (const [name, metric] of Object.entries(METRIC_CANONICAL)) {
      this.metricsByName.set(normalizeName(metric), name as ExprMetricName);
    }
    for (const [name, metric] of Object.entries(env.metricNames ?? {})) {
      const key = normalizeName(name);
      if (key && !this.metricsByName.has(key)) this.metricsByName.set(key, metric);
    }
  }

  private peek(): Token {
    return this.tokens[this.position];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    if (token.kind !== 'eof') this.position += 1;
    return token;
  }

  private isKeyword(token: Token, word: string): boolean {
    return token.kind === 'ident' && token.text.toLowerCase() === word;
  }

  private unexpected(token: Token): never {
    if (token.kind === 'eof') throw new ExpressionError('unexpectedEnd', token.start, token.end);
    const shown =
      token.kind === 'string'
        ? `"${token.text}"`
        : token.kind === 'field'
          ? `[${token.text}]`
          : token.text;
    throw new ExpressionError('unexpectedToken', token.start, token.end, shown);
  }

  private enter(token: Token) {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new ExpressionError('tooComplex', token.start, token.end);
  }

  parse(): ExprNode {
    if (this.peek().kind === 'eof') throw new ExpressionError('empty', 0, 0);
    const node = this.parseOr();
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      if (rest.kind === ')')
        throw new ExpressionError('unexpectedToken', rest.start, rest.end, ')');
      this.unexpected(rest);
    }
    return node;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.isKeyword(this.peek(), 'or')) {
      this.next();
      const right = this.parseAnd();
      left = { kind: 'binary', op: 'or', left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot();
    while (this.isKeyword(this.peek(), 'and')) {
      this.next();
      const right = this.parseNot();
      left = { kind: 'binary', op: 'and', left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseNot(): ExprNode {
    const token = this.peek();
    if (this.isKeyword(token, 'not')) {
      this.next();
      this.enter(token);
      const arg = this.parseNot();
      this.depth -= 1;
      return { kind: 'not', arg, start: token.start, end: arg.end };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExprNode {
    const left = this.parseAdditive();
    const token = this.peek();
    if (token.kind === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(token.text)) {
      this.next();
      const right = this.parseAdditive();
      const after = this.peek();
      if (after.kind === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(after.text)) {
        this.unexpected(after);
      }
      return {
        kind: 'binary',
        op: token.text as ExprBinaryOp,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'op' || (token.text !== '+' && token.text !== '-')) return left;
      this.next();
      const right = this.parseMultiplicative();
      left = {
        kind: 'binary',
        op: token.text as ExprBinaryOp,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'op' || (token.text !== '*' && token.text !== '/')) return left;
      this.next();
      const right = this.parseUnary();
      left = {
        kind: 'binary',
        op: token.text as ExprBinaryOp,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
  }

  private parseUnary(): ExprNode {
    const token = this.peek();
    if (token.kind === 'op' && (token.text === '-' || token.text === '+')) {
      this.next();
      this.enter(token);
      const arg = this.parseUnary();
      this.depth -= 1;
      if (token.text === '+') return { ...arg, start: token.start };
      return { kind: 'negate', arg, start: token.start, end: arg.end };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const token = this.next();
    switch (token.kind) {
      case 'number': {
        const value = Number(token.text);
        if (!Number.isFinite(value)) {
          throw new ExpressionError('unexpectedToken', token.start, token.end, token.text);
        }
        return { kind: 'number', value, start: token.start, end: token.end };
      }
      case 'string':
        return { kind: 'string', value: token.text, start: token.start, end: token.end };
      case 'field': {
        const field = this.fieldsByName.get(normalizeName(token.text));
        if (!field) throw new ExpressionError('unknownField', token.start, token.end, token.text);
        return { kind: 'field', id: field.id, start: token.start, end: token.end };
      }
      case '(': {
        this.enter(token);
        const inner = this.parseOr();
        this.depth -= 1;
        const close = this.next();
        if (close.kind !== ')') throw new ExpressionError('missingParen', close.start, close.end);
        return { ...inner, start: token.start, end: close.end };
      }
      case 'ident':
        return this.parseIdentifier(token);
      default:
        return this.unexpected(token);
    }
  }

  private parseIdentifier(token: Token): ExprNode {
    const lower = token.text.toLowerCase();
    if (lower === 'true' || lower === 'false') {
      return { kind: 'boolean', value: lower === 'true', start: token.start, end: token.end };
    }
    if (this.peek().kind === '(') {
      const fn = (lower in FUNCTIONS ? lower : FUNCTION_ALIASES[lower]) as ExprFunction | undefined;
      if (!fn) throw new ExpressionError('unknownFunction', token.start, token.end, token.text);
      this.next();
      this.enter(token);
      const args: ExprNode[] = [];
      if (this.peek().kind !== ')') {
        for (;;) {
          args.push(this.parseOr());
          if (this.peek().kind !== ',') break;
          this.next();
        }
      }
      this.depth -= 1;
      const close = this.next();
      if (close.kind !== ')') {
        if (close.kind === 'eof') throw new ExpressionError('missingParen', close.start, close.end);
        this.unexpected(close);
      }
      const def = FUNCTIONS[fn];
      if (args.length < def.minArgs || args.length > def.maxArgs) {
        throw new ExpressionError('argumentCount', token.start, close.end, def.canonical);
      }
      return { kind: 'call', fn, args, start: token.start, end: close.end };
    }
    const metric = this.metricsByName.get(normalizeName(token.text));
    if (metric) return { kind: 'metric', name: metric, start: token.start, end: token.end };
    if (lower in FUNCTIONS || lower in FUNCTION_ALIASES) {
      // A function name without its parentheses.
      throw new ExpressionError('missingParen', token.end, token.end);
    }
    throw new ExpressionError('unknownName', token.start, token.end, token.text);
  }
}

// ---------------------------------------------------------------------------
// Type checking
// ---------------------------------------------------------------------------

export interface ExprInfo {
  type: ExprValueType;
  /** Number that is an amount of money (format as currency). */
  money: boolean;
  /** Contains an aggregation (metric level). */
  aggregated: boolean;
}

interface CheckState {
  env: ExprEnv;
  fields: Map<string, ExprField>;
  inAggregate: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function expectType(node: ExprNode, info: ExprInfo, type: ExprValueType) {
  if (info.type === type) return;
  const code: ExprErrorCode =
    type === 'number' ? 'expectedNumber' : type === 'boolean' ? 'expectedBoolean' : 'expectedText';
  throw new ExpressionError(code, node.start, node.end);
}

function check(node: ExprNode, state: CheckState): ExprInfo {
  const plain = (type: ExprValueType, money = false, aggregated = false): ExprInfo => ({
    type,
    money,
    aggregated,
  });
  switch (node.kind) {
    case 'number':
      return plain('number');
    case 'string':
      return plain('string');
    case 'boolean':
      return plain('boolean');
    case 'field': {
      const field = state.fields.get(node.id);
      if (!field) throw new ExpressionError('unknownField', node.start, node.end, node.id);
      if (state.env.level === 'metric' && !state.inAggregate) {
        throw new ExpressionError('fieldOutsideAggregate', node.start, node.end, node.id);
      }
      return plain(field.type, Boolean(field.money && field.type === 'number'));
    }
    case 'metric': {
      const name = METRIC_CANONICAL[node.name];
      if (state.env.level === 'row') {
        throw new ExpressionError('metricInColumn', node.start, node.end, name);
      }
      if (state.inAggregate) {
        throw new ExpressionError('nestedAggregate', node.start, node.end, name);
      }
      if (node.name !== 'count' && !state.env.budgetMetrics) {
        throw new ExpressionError('metricUnavailable', node.start, node.end, name);
      }
      return plain('number', node.name !== 'count', true);
    }
    case 'negate': {
      const arg = check(node.arg, state);
      expectType(node.arg, arg, 'number');
      return arg;
    }
    case 'not': {
      const arg = check(node.arg, state);
      expectType(node.arg, arg, 'boolean');
      return { ...arg, type: 'boolean', money: false };
    }
    case 'binary':
      return checkBinary(node, state);
    case 'call':
      return checkCall(node, state);
  }
}

function checkBinary(node: Extract<ExprNode, { kind: 'binary' }>, state: CheckState): ExprInfo {
  const left = check(node.left, state);
  const right = check(node.right, state);
  const aggregated = left.aggregated || right.aggregated;
  switch (node.op) {
    case 'and':
    case 'or':
      expectType(node.left, left, 'boolean');
      expectType(node.right, right, 'boolean');
      return { type: 'boolean', money: false, aggregated };
    case '+':
    case '-':
    case '*':
    case '/': {
      expectType(node.left, left, 'number');
      expectType(node.right, right, 'number');
      let money: boolean;
      if (node.op === '+' || node.op === '-') money = left.money || right.money;
      else if (node.op === '*') money = left.money !== right.money;
      else money = left.money && !right.money;
      return { type: 'number', money, aggregated };
    }
    default: {
      // Comparisons: same types; a date compares with a "YYYY-MM-DD" text literal.
      const dateVsText = (date: ExprInfo, other: ExprNode, otherInfo: ExprInfo) =>
        date.type === 'date' && otherInfo.type === 'string' && other.kind === 'string';
      if (dateVsText(left, node.right, right)) {
        if (!isIsoDate((node.right as { value: string }).value)) {
          throw new ExpressionError('invalidDate', node.right.start, node.right.end);
        }
      } else if (dateVsText(right, node.left, left)) {
        if (!isIsoDate((node.left as { value: string }).value)) {
          throw new ExpressionError('invalidDate', node.left.start, node.left.end);
        }
      } else if (left.type !== right.type) {
        throw new ExpressionError('typeMismatch', node.start, node.end);
      }
      return { type: 'boolean', money: false, aggregated };
    }
  }
}

function checkCall(node: Extract<ExprNode, { kind: 'call' }>, state: CheckState): ExprInfo {
  const def = FUNCTIONS[node.fn];
  if (def.aggregate) {
    if (state.env.level === 'row') {
      throw new ExpressionError('aggregateInColumn', node.start, node.end, def.canonical);
    }
    if (state.inAggregate) {
      throw new ExpressionError('nestedAggregate', node.start, node.end, def.canonical);
    }
    const inner: CheckState = { ...state, inAggregate: def.canonical };
    const args = node.args.map((arg) => check(arg, inner));
    switch (node.fn) {
      case 'sum':
      case 'avg':
      case 'min':
      case 'max':
        expectType(node.args[0], args[0], 'number');
        return { type: 'number', money: args[0].money, aggregated: true };
      case 'sumif':
        expectType(node.args[0], args[0], 'number');
        expectType(node.args[1], args[1], 'boolean');
        return { type: 'number', money: args[0].money, aggregated: true };
      case 'countif':
        expectType(node.args[0], args[0], 'boolean');
        return { type: 'number', money: false, aggregated: true };
      default:
        // count, distinct
        return { type: 'number', money: false, aggregated: true };
    }
  }

  const args = node.args.map((arg) => check(arg, state));
  const aggregated = args.some((arg) => arg.aggregated);
  switch (node.fn) {
    case 'abs':
      expectType(node.args[0], args[0], 'number');
      return { ...args[0], aggregated };
    case 'round': {
      expectType(node.args[0], args[0], 'number');
      const digits = node.args[1];
      if (digits) {
        const value =
          digits.kind === 'number'
            ? digits.value
            : digits.kind === 'negate' && digits.arg.kind === 'number'
              ? -digits.arg.value
              : NaN;
        if (!Number.isInteger(value) || value < -10 || value > 10) {
          throw new ExpressionError('roundDigits', digits.start, digits.end);
        }
      }
      return { ...args[0], aggregated };
    }
    case 'contains':
      expectType(node.args[0], args[0], 'string');
      expectType(node.args[1], args[1], 'string');
      return { type: 'boolean', money: false, aggregated };
    case 'coalesce': {
      const [first] = args;
      node.args.forEach((arg, index) => {
        if (args[index].type !== first.type) {
          throw new ExpressionError('typeMismatch', arg.start, arg.end);
        }
      });
      return { type: first.type, money: args.some((arg) => arg.money), aggregated };
    }
    case 'case': {
      // case(cond, value, cond, value, …, [default])
      const values: { node: ExprNode; info: ExprInfo }[] = [];
      for (let index = 0; index < node.args.length; index += 2) {
        const isDefault = index === node.args.length - 1;
        if (isDefault) {
          values.push({ node: node.args[index], info: args[index] });
        } else {
          expectType(node.args[index], args[index], 'boolean');
          values.push({ node: node.args[index + 1], info: args[index + 1] });
        }
      }
      const { type } = values[0].info;
      for (const value of values) {
        if (value.info.type !== type) {
          throw new ExpressionError('typeMismatch', value.node.start, value.node.end);
        }
      }
      return { type, money: values.some((value) => value.info.money), aggregated };
    }
    default:
      return { type: 'number', money: false, aggregated };
  }
}

// ---------------------------------------------------------------------------
// Public parse
// ---------------------------------------------------------------------------

export interface ParsedExpression {
  ast: ExprNode;
  info: ExprInfo;
}

export type ParseResult =
  { ok: true; value: ParsedExpression } | { ok: false; error: ExpressionError };

/** Parses and type-checks an expression for a column ('row') or metric ('metric'). Never throws. */
export function parseExpression(text: string, env: ExprEnv): ParseResult {
  try {
    if (typeof text !== 'string') throw new ExpressionError('empty', 0, 0);
    if (text.length > MAX_EXPRESSION_LENGTH) {
      throw new ExpressionError('tooLong', MAX_EXPRESSION_LENGTH, text.length);
    }
    const ast = new Parser(tokenize(text), env).parse();
    const fields = new Map(env.fields.map((field) => [field.id, field]));
    const info = check(ast, { env, fields, inAggregate: null });
    if (env.level === 'metric') {
      if (info.type !== 'number') {
        throw new ExpressionError('metricResultNotNumber', ast.start, ast.end);
      }
      if (!info.aggregated) throw new ExpressionError('needsAggregate', ast.start, ast.end);
    } else if (info.type === 'date') {
      throw new ExpressionError('columnResultDate', ast.start, ast.end);
    }
    return { ok: true, value: { ast, info } };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error };
    // Anything else (e.g. a stack overflow) is reported as too complex.
    return { ok: false, error: new ExpressionError('tooComplex', 0, String(text).length) };
  }
}

/** Field / custom column ids an expression references. */
export function expressionFieldIds(node: ExprNode): string[] {
  const ids = new Set<string>();
  const walk = (current: ExprNode) => {
    switch (current.kind) {
      case 'field':
        ids.add(current.id);
        break;
      case 'negate':
      case 'not':
        walk(current.arg);
        break;
      case 'binary':
        walk(current.left);
        walk(current.right);
        break;
      case 'call':
        current.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(node);
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const PRECEDENCE: Record<ExprBinaryOp, number> = {
  or: 1,
  and: 2,
  '=': 4,
  '!=': 4,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
};

function nodePrecedence(node: ExprNode): number {
  if (node.kind === 'binary') return PRECEDENCE[node.op];
  if (node.kind === 'not') return 3;
  if (node.kind === 'negate') return 7;
  return 8;
}

function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function printNumber(value: number): string {
  // Plain decimal notation (no exponent), so the text parses back.
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return value.toFixed(0);
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

export interface PrintOptions {
  /** Name shown in brackets for a field id; defaults to the id (canonical form). */
  fieldName?: (id: string) => string;
  /** Name for a budget metric; defaults to the English name. */
  metricName?: (name: ExprMetricName) => string;
}

/** Text for an AST: canonical (ids) by default, or with display names. */
export function printExpression(node: ExprNode, options: PrintOptions = {}): string {
  const fieldName = options.fieldName ?? ((id: string) => id);
  const metricName = options.metricName ?? ((name: ExprMetricName) => METRIC_CANONICAL[name]);
  const print = (current: ExprNode, parent: number, rightSide = false): string => {
    const own = nodePrecedence(current);
    let text: string;
    switch (current.kind) {
      case 'number':
        text = printNumber(current.value);
        break;
      case 'string':
        text = quoteString(current.value);
        break;
      case 'boolean':
        text = current.value ? 'true' : 'false';
        break;
      case 'field':
        text = `[${fieldName(current.id)}]`;
        break;
      case 'metric':
        text = metricName(current.name);
        break;
      case 'negate':
        text = `-${print(current.arg, own)}`;
        break;
      case 'not':
        text = `not ${print(current.arg, own)}`;
        break;
      case 'binary': {
        const op = current.op === '!=' ? '!=' : current.op;
        text = `${print(current.left, own)} ${op} ${print(current.right, own, true)}`;
        break;
      }
      case 'call':
        text = `${FUNCTIONS[current.fn].canonical}(${current.args.map((arg) => print(arg, 0)).join(', ')})`;
        break;
    }
    // Same-precedence right operands keep their parentheses: a - (b - c);
    // comparisons don't chain, so a nested one always keeps them.
    const needsParens =
      own < parent || (own === parent && own !== 8 && (rightSide || own === PRECEDENCE['=']));
    return needsParens ? `(${text})` : text;
  };
  return print(node, 0);
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export interface ExprSqlEnv {
  /** SQL for a field reference (a known column, never user text). */
  field: (id: string) => string;
  /** SQL for a budget metric (Spending, Income, Net, Count). */
  metric: (name: ExprMetricName) => string;
  /** SQL counting the rows (transactions) matching a condition. */
  countIf: (conditionSql: string) => string;
  /** Escaped SQL string literal. */
  string: (value: string) => string;
}

function sqlNumberLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Invalid number in expression');
  const text = printNumber(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error('Invalid number in expression');
  return text;
}

/**
 * SQL for a checked expression. `fieldTypes` gives each field's type so text
 * comparisons can ignore case and dates compare as dates.
 */
export function expressionToSql(
  node: ExprNode,
  env: ExprSqlEnv,
  fieldTypes: ReadonlyMap<string, ExprValueType>
): string {
  const typeOf = (current: ExprNode): ExprValueType | null => {
    switch (current.kind) {
      case 'number':
      case 'negate':
        return 'number';
      case 'string':
        return 'string';
      case 'boolean':
      case 'not':
        return 'boolean';
      case 'field':
        return fieldTypes.get(current.id) ?? null;
      case 'metric':
        return 'number';
      case 'binary':
        return ['+', '-', '*', '/'].includes(current.op) ? 'number' : 'boolean';
      case 'call':
        if (current.fn === 'coalesce') return typeOf(current.args[0]);
        if (current.fn === 'case') return typeOf(current.args[1] ?? current.args[0]);
        if (current.fn === 'contains') return 'boolean';
        return 'number';
    }
  };

  const sql = (current: ExprNode): string => {
    switch (current.kind) {
      case 'number':
        return sqlNumberLiteral(current.value);
      case 'string':
        return env.string(current.value);
      case 'boolean':
        return current.value ? 'TRUE' : 'FALSE';
      case 'field':
        return env.field(current.id);
      case 'metric':
        return `(${env.metric(current.name)})`;
      case 'negate':
        return `(-${sql(current.arg)})`;
      case 'not':
        return `(NOT ${sql(current.arg)})`;
      case 'binary': {
        const { op, left, right } = current;
        if (op === 'and' || op === 'or') {
          return `(${sql(left)} ${op.toUpperCase()} ${sql(right)})`;
        }
        if (op === '/') {
          return `(CAST(${sql(left)} AS DOUBLE) / NULLIF(CAST(${sql(right)} AS DOUBLE), 0))`;
        }
        if (op === '+' || op === '-' || op === '*') return `(${sql(left)} ${op} ${sql(right)})`;
        const leftType = typeOf(left);
        const rightType = typeOf(right);
        const sqlOp = op === '!=' ? '<>' : op;
        if (leftType === 'date' || rightType === 'date') {
          const side = (part: ExprNode, type: ExprValueType | null) =>
            type === 'string' && part.kind === 'string'
              ? `CAST(${env.string(part.value)} AS DATE)`
              : sql(part);
          return `(${side(left, leftType)} ${sqlOp} ${side(right, rightType)})`;
        }
        if (leftType === 'string') {
          return `(LOWER(${sql(left)}) ${sqlOp} LOWER(${sql(right)}))`;
        }
        return `(${sql(left)} ${sqlOp} ${sql(right)})`;
      }
      case 'call': {
        const { args } = current;
        switch (current.fn) {
          case 'sum':
            return `CAST(COALESCE(SUM(${sql(args[0])}), 0) AS DOUBLE)`;
          case 'avg':
            return `CAST(AVG(${sql(args[0])}) AS DOUBLE)`;
          case 'min':
            return `CAST(MIN(${sql(args[0])}) AS DOUBLE)`;
          case 'max':
            return `CAST(MAX(${sql(args[0])}) AS DOUBLE)`;
          case 'count':
            return `(${env.metric('count')})`;
          case 'countif':
            return `(${env.countIf(sql(args[0]))})`;
          case 'sumif':
            return `CAST(COALESCE(SUM(CASE WHEN ${sql(args[1])} THEN ${sql(args[0])} ELSE 0 END), 0) AS DOUBLE)`;
          case 'distinct':
            return `COUNT(DISTINCT ${sql(args[0])})`;
          case 'abs':
            return `ABS(${sql(args[0])})`;
          case 'round': {
            if (!args[1]) return `ROUND(${sql(args[0])})`;
            const digits = args[1];
            const value =
              digits.kind === 'number'
                ? digits.value
                : digits.kind === 'negate' && digits.arg.kind === 'number'
                  ? -digits.arg.value
                  : 0;
            if (!Number.isInteger(value) || Math.abs(value) > 10) {
              throw new Error('Invalid round() digits');
            }
            return `ROUND(${sql(args[0])}, ${value})`;
          }
          case 'coalesce':
            return `COALESCE(${args.map(sql).join(', ')})`;
          case 'contains':
            return `contains(LOWER(COALESCE(${sql(args[0])}, '')), LOWER(${sql(args[1])}))`;
          case 'case': {
            const parts: string[] = [];
            let otherwise = 'NULL';
            for (let index = 0; index < args.length; index += 2) {
              if (index === args.length - 1) otherwise = sql(args[index]);
              else parts.push(`WHEN ${sql(args[index])} THEN ${sql(args[index + 1])}`);
            }
            return `(CASE ${parts.join(' ')} ELSE ${otherwise} END)`;
          }
        }
      }
    }
  };
  return sql(node);
}
