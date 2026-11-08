import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, FunctionSquare, Sigma } from 'lucide-react';
import {
  MAX_NAME_LENGTH,
  SOURCE_FIELDS,
  customFields,
  expressionFields,
  expressionFunctionNames,
  parseExpression,
  printExpression,
  type ExprEnv,
  type ExprMetricName,
  type QuestionSource,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Textarea } from '@shared/ui/textarea';
import { cn } from '@shared/lib/utils';
import {
  expressionErrorMessage,
  expressionFieldNames,
  expressionMetricNames,
  fieldLabel,
} from './question-labels';

export type ExpressionKind = 'column' | 'metric';

interface ExpressionEditorProps {
  spec: QuestionSpec;
  kind: ExpressionKind;
  /** Existing custom column (with its id) or metric being edited. */
  initial?: { id?: string; name?: string; expression: string };
  /** Receives the name and the canonical expression (field ids). */
  onSubmit: (value: { name: string; expression: string }) => void;
  onCancel: () => void;
  /** Back to the metric picker. */
  onBack?: () => void;
}

const EXAMPLES: Record<ExpressionKind, Record<QuestionSource, string[]>> = {
  column: {
    transactions: [
      'abs([amount])',
      'case([amount] < 0, "Out", "In")',
      'contains([memo], "refund")',
    ],
    budget: ['[assigned] + [activity]', 'case([activity] < -[assigned], "Over", "OK")'],
    accounts: ['case([balance] < 0, "Owing", "Positive")', 'round([balance], -2)'],
  },
  metric: {
    transactions: [
      'Spending / Income * 100',
      'SumIf([outflow], [category] = "Groceries")',
      'CountIf([amount] < -100)',
    ],
    budget: ['Sum([assigned]) + Sum([activity])', 'SumIf([activity], [activity] < 0)'],
    accounts: ['Sum([balance])', 'CountIf([balance] < 0)'],
  },
};

const MAX_SUGGESTIONS = 8;

interface Suggestion {
  key: string;
  label: string;
  insert: string;
  /** Characters before the cursor the insert replaces. */
  from: number;
  /** Skip a closing bracket right after the cursor. */
  eatClose?: boolean;
  kind: 'field' | 'function' | 'metric';
}

/**
 * Name + expression form for a custom column or custom metric: live
 * validation with the problem's position, field autocomplete after "[",
 * function / metric name completion, and examples.
 */
export function ExpressionEditor({
  spec,
  kind,
  initial,
  onSubmit,
  onCancel,
  onBack,
}: ExpressionEditorProps) {
  const { t } = useLingui();
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Caret position to restore right after the next render (before more typing lands).
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const position = pendingCursor.current;
    const element = textareaRef.current;
    if (position === null || !element) return;
    pendingCursor.current = null;
    element.focus();
    element.setSelectionRange(position, position);
  });
  const level = kind === 'column' ? 'row' : 'metric';

  // Custom columns may only use the ones defined before them.
  const custom = useMemo(() => {
    const columns = spec.customColumns ?? [];
    const editing = initial?.id ? columns.findIndex((column) => column.id === initial.id) : -1;
    return customFields(
      spec.source,
      kind === 'column' && editing >= 0 ? columns.slice(0, editing) : columns
    );
  }, [spec.source, spec.customColumns, kind, initial?.id]);

  const displayName = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of custom.values()) names.set(entry.column.id, entry.column.name);
    return (fieldId: string) => names.get(fieldId) ?? fieldLabel(spec.source, fieldId);
  }, [custom, spec.source]);

  const metricNames = useMemo(() => expressionMetricNames(), []);
  const metricDisplay = useMemo(() => {
    const byMetric = new Map<ExprMetricName, string>();
    for (const [name, metric] of Object.entries(metricNames)) {
      if (!byMetric.has(metric)) byMetric.set(metric, name);
    }
    return (metric: ExprMetricName) => byMetric.get(metric) ?? metric;
  }, [metricNames]);

  const env: ExprEnv = useMemo(
    () => ({
      fields: expressionFields(spec.source, custom, (fieldId) =>
        expressionFieldNames(spec.source, fieldId)
      ),
      level,
      budgetMetrics: spec.source === 'transactions',
      metricNames,
    }),
    [spec.source, custom, level, metricNames]
  );

  const toDisplay = (canonical: string): string | null => {
    const parsed = parseExpression(canonical, env);
    return parsed.ok
      ? printExpression(parsed.value.ast, { fieldName: displayName, metricName: metricDisplay })
      : null;
  };

  const [text, setText] = useState(() =>
    initial ? (toDisplay(initial.expression) ?? initial.expression) : ''
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [touched, setTouched] = useState(Boolean(initial));

  const parsed = useMemo(() => parseExpression(text, env), [text, env]);
  const error = parsed.ok ? null : parsed.error;

  const nameError = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return t`Give it a name.`;
    if (trimmed.length > MAX_NAME_LENGTH) return t`Use at most ${MAX_NAME_LENGTH} characters.`;
    if (/[[\]]/.test(trimmed)) return t`Names can’t contain [ or ].`;
    if (kind === 'column') {
      const lower = trimmed.toLocaleLowerCase();
      const taken =
        (spec.customColumns ?? []).some(
          (column) => column.id !== initial?.id && column.name.toLocaleLowerCase() === lower
        ) ||
        SOURCE_FIELDS[spec.source].some(
          (field) =>
            field.id === lower || fieldLabel(spec.source, field.id).toLocaleLowerCase() === lower
        );
      if (taken) return t`A field with this name already exists.`;
    }
    return null;
  }, [name, kind, spec.customColumns, spec.source, initial?.id, t]);

  // Autocomplete for the text before the cursor.
  const suggestions = useMemo((): Suggestion[] => {
    if (dismissed) return [];
    const before = text.slice(0, cursor);
    const open = before.lastIndexOf('[');
    if (open > before.lastIndexOf(']')) {
      const prefix = before.slice(open + 1).toLocaleLowerCase();
      const fields = env.fields.map((field) => ({ id: field.id, label: displayName(field.id) }));
      const matches = fields.filter((field) => field.label.toLocaleLowerCase().includes(prefix));
      matches.sort(
        (a, b) =>
          Number(!a.label.toLocaleLowerCase().startsWith(prefix)) -
          Number(!b.label.toLocaleLowerCase().startsWith(prefix))
      );
      return matches.slice(0, MAX_SUGGESTIONS).map((field) => ({
        key: `field-${field.id}`,
        label: field.label,
        insert: `[${field.label}]`,
        from: open,
        eatClose: text[cursor] === ']',
        kind: 'field',
      }));
    }
    const word = /[\p{L}_][\p{L}\p{N}_]*$/u.exec(before);
    if (!word || /["']/.test(before.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ''))) {
      return [];
    }
    const prefix = word[0].toLocaleLowerCase();
    const from = before.length - word[0].length;
    const functions = expressionFunctionNames(level).map((fn) => ({
      key: `fn-${fn}`,
      label: `${fn}(…)`,
      insert: `${fn}(`,
      from,
      kind: 'function' as const,
    }));
    const metrics =
      level === 'metric'
        ? (['spending', 'income', 'net', 'count'] as const)
            .filter((metric) => metric === 'count' || env.budgetMetrics)
            .map((metric) => ({
              key: `metric-${metric}`,
              label: metricDisplay(metric),
              insert: metricDisplay(metric),
              from,
              kind: 'metric' as const,
            }))
        : [];
    return [...metrics, ...functions]
      .filter(
        (item) =>
          item.insert.toLocaleLowerCase().startsWith(prefix) &&
          item.insert.toLocaleLowerCase() !== prefix
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [dismissed, text, cursor, env, displayName, level, metricDisplay]);
  const listOpen = suggestions.length > 0;
  const activeIndex = Math.min(active, suggestions.length - 1);

  const accept = (suggestion: Suggestion) => {
    const end = cursor + (suggestion.eatClose ? 1 : 0);
    const next = text.slice(0, suggestion.from) + suggestion.insert + text.slice(end);
    const position = suggestion.from + suggestion.insert.length;
    setText(next);
    setCursor(position);
    setActive(0);
    setTouched(true);
    pendingCursor.current = position;
  };

  const canSubmit = parsed.ok && !nameError;
  const submit = () => {
    setTouched(true);
    if (!parsed.ok || nameError) return;
    onSubmit({ name: name.trim(), expression: printExpression(parsed.value.ast) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (!listOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      accept(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  };

  const examples = EXAMPLES[kind][spec.source]
    .map((example) => toDisplay(example))
    .filter((example): example is string => example !== null);

  const listId = `${id}-suggestions`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const showError = touched && error !== null && text.trim().length > 0;
  const position = error ? error.start + 1 : 0;
  const title = initial
    ? kind === 'column'
      ? t`Edit custom column`
      : t`Edit custom metric`
    : kind === 'column'
      ? t`New custom column`
      : t`New custom metric`;

  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-label={title}
    >
      <div className="flex items-center gap-1.5">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onBack}
            aria-label={t`Back`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        )}
        {kind === 'column' ? (
          <FunctionSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <Sigma className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-expression`}>
          <Trans>Expression</Trans>
        </Label>
        <div className="relative">
          <Textarea
            ref={textareaRef}
            id={`${id}-expression`}
            value={text}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            placeholder={kind === 'column' ? 'abs([…])' : 'Sum([…]) / Count'}
            className="min-h-20 font-mono text-sm"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={
              listOpen ? `${listId}-${suggestions[activeIndex].key}` : undefined
            }
            aria-invalid={showError}
            aria-describedby={`${showError ? errorId : ''} ${helpId}`.trim()}
            onChange={(event) => {
              setText(event.target.value);
              setCursor(event.target.selectionStart ?? event.target.value.length);
              setDismissed(false);
              setActive(0);
            }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
            onBlur={() => setTouched(true)}
            onKeyDown={onKeyDown}
          />
          {listOpen && (
            <ul
              id={listId}
              role="listbox"
              aria-label={t`Suggestions`}
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.key}
                  id={`${listId}-${suggestion.key}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    accept(suggestion);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1 text-sm',
                    index === activeIndex && 'bg-accent text-accent-foreground'
                  )}
                >
                  <span className="truncate font-mono">{suggestion.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {suggestion.kind === 'field'
                      ? t`field`
                      : suggestion.kind === 'metric'
                        ? t`metric`
                        : t`function`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {showError && error && (
          <div id={errorId} className="space-y-1 text-xs text-destructive" aria-live="polite">
            <p>
              {expressionErrorMessage(error)}{' '}
              <span className="text-muted-foreground">
                <Trans>(at character {position})</Trans>
              </span>
            </p>
            <pre
              aria-hidden
              className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-foreground"
            >
              {text.slice(0, error.start)}
              <mark className="rounded-sm bg-destructive/25 text-foreground underline decoration-destructive decoration-wavy">
                {text.slice(error.start, Math.max(error.end, error.start + 1)) || ' '}
              </mark>
              {text.slice(Math.max(error.end, error.start + 1))}
            </pre>
          </div>
        )}
        <p id={helpId} className="text-xs text-muted-foreground">
          {kind === 'column' ? (
            <Trans>
              Type [ for fields. Use + − × ÷, comparisons, and abs, round, case, coalesce, contains.
            </Trans>
          ) : (
            <Trans>
              Type [ for fields. Use Sum, Avg, Min, Max, Count, CountIf, SumIf, Distinct, and
              Spending, Income, Net.
            </Trans>
          )}
        </p>
      </div>

      {examples.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            <Trans>Examples</Trans>
          </p>
          <ul className="flex flex-col gap-1">
            {examples.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    setText(example);
                    setCursor(example.length);
                    setDismissed(true);
                    setTouched(true);
                    textareaRef.current?.focus();
                  }}
                  className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>
          <Trans>Name</Trans>
        </Label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder={kind === 'column' ? t`e.g. Size` : t`e.g. Savings rate`}
          aria-invalid={touched && nameError !== null && name.length > 0}
          aria-describedby={touched && nameError ? `${id}-name-error` : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {touched && nameError && name.length > 0 && (
          <p id={`${id}-name-error`} className="text-xs text-destructive">
            {nameError}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {initial ? <Trans>Update</Trans> : <Trans>Done</Trans>}
        </Button>
      </div>
    </form>
  );
}
