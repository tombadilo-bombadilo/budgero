import { plural, t } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import {
  PRIMARY_DATE_FIELD,
  RELATIVE_UNITS,
  SOURCE_FIELDS,
  getField,
  normalizeFilter,
  operatorsFor,
  type FieldDef,
  type FilterOp,
  type FilterValue,
  type QuestionFilter,
  type QuestionSource,
  type RelativeUnit,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { cn } from '@shared/lib/utils';
import {
  booleanLabel,
  fieldDescription,
  fieldLabel,
  operatorLabel,
  unitLabel,
} from './question-labels';
import type { FieldValueOptions } from './useFieldValueOptions';
import { FieldIcon } from './FieldIcon';

interface FilterEditorProps {
  source: QuestionSource;
  /** Filter being edited; omitted when adding. */
  initial?: QuestionFilter;
  valueOptions: FieldValueOptions;
  onSubmit: (filter: QuestionFilter) => void;
  onCancel: () => void;
}

/** Field list → operator → value, Metabase-style, in one popover. */
export function FilterEditor({
  source,
  initial,
  valueOptions,
  onSubmit,
  onCancel,
}: FilterEditorProps) {
  const [fieldId, setFieldId] = useState<string | null>(initial?.field ?? null);
  const field = fieldId ? getField(source, fieldId) : undefined;

  if (!field) {
    const dateField = PRIMARY_DATE_FIELD[source];
    return (
      <div>
        {dateField && !initial && (
          <QuickDateRanges
            field={getField(source, dateField)}
            label={fieldLabel(source, dateField)}
            onPick={(range) => onSubmit({ field: dateField, values: [], ...range })}
          />
        )}
        <FieldList source={source} onPick={setFieldId} />
      </div>
    );
  }
  return (
    <FilterForm
      key={field.id}
      source={source}
      field={field}
      initial={initial?.field === field.id ? initial : undefined}
      valueOptions={valueOptions}
      onBack={initial ? undefined : () => setFieldId(null)}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

type QuickRange = Pick<QuestionFilter, 'op' | 'amount' | 'unit' | 'includeCurrent'>;

/** One-tap date ranges, as relative filters (they keep rolling). */
const QUICK_RANGES: { id: string; range: QuickRange }[] = [
  { id: 'thisMonth', range: { op: 'current', unit: 'month' } },
  { id: 'lastMonth', range: { op: 'previous', amount: 1, unit: 'month', includeCurrent: false } },
  { id: 'last30', range: { op: 'previous', amount: 30, unit: 'day', includeCurrent: true } },
  { id: 'last3m', range: { op: 'previous', amount: 3, unit: 'month', includeCurrent: true } },
  { id: 'last12m', range: { op: 'previous', amount: 12, unit: 'month', includeCurrent: true } },
  { id: 'thisYear', range: { op: 'current', unit: 'year' } },
  { id: 'lastYear', range: { op: 'previous', amount: 1, unit: 'year', includeCurrent: false } },
];

function quickRangeLabel(id: string): string {
  switch (id) {
    case 'thisMonth':
      return t`This month`;
    case 'lastMonth':
      return t`Last month`;
    case 'last30':
      return t`Last 30 days`;
    case 'last3m':
      return t`Last 3 months`;
    case 'last12m':
      return t`Last 12 months`;
    case 'thisYear':
      return t`This year`;
    default:
      return t`Last year`;
  }
}

function sameRange(filter: Partial<QuestionFilter>, range: QuickRange): boolean {
  return (
    filter.op === range.op &&
    filter.unit === range.unit &&
    (range.op === 'current' ||
      (filter.amount === range.amount && filter.includeCurrent === range.includeCurrent))
  );
}

/** Shortcut chips for the common date ranges. */
function QuickDateRanges({
  field,
  label,
  current,
  onPick,
}: {
  field: FieldDef | undefined;
  label?: string;
  current?: Partial<QuestionFilter>;
  onPick: (range: QuickRange) => void;
}) {
  const { t } = useLingui();
  // Month-level dates (budget months) have no day ranges.
  const ranges = QUICK_RANGES.filter(
    ({ range }) => range.unit !== 'day' || field?.buckets?.includes('day')
  );
  return (
    <div className="border-b p-2" role="group" aria-label={t`Quick date ranges`}>
      {label && <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="flex flex-wrap gap-1.5">
        {ranges.map(({ id, range }) => {
          const selected = current ? sameRange(current, range) : false;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(range)}
              className={cn(
                'min-h-8 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary bg-primary/10 font-medium'
                  : 'border-border hover:bg-muted'
              )}
            >
              {quickRangeLabel(id)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FieldList({
  source,
  onPick,
  fields,
  placeholder,
  labelOf,
}: {
  source: QuestionSource;
  onPick: (fieldId: string) => void;
  fields?: readonly FieldDef[];
  placeholder?: string;
  /** Label for a field id (custom columns); defaults to the source field label. */
  labelOf?: (fieldId: string) => string;
}) {
  const { t } = useLingui();
  const label = labelOf ?? ((fieldId: string) => fieldLabel(source, fieldId));
  // Custom columns (not source fields) have no description.
  const hintOf = (fieldId: string) =>
    getField(source, fieldId) ? fieldDescription(source, fieldId) : null;
  return (
    <Command>
      <CommandInput placeholder={placeholder ?? t`Filter by…`} aria-label={t`Find a field`} />
      <CommandList className="max-h-72">
        <CommandEmpty>
          <Trans>No matching fields.</Trans>
        </CommandEmpty>
        <CommandGroup>
          {(fields ?? SOURCE_FIELDS[source]).map((item) => (
            <CommandItem
              key={item.id}
              value={`${label(item.id)} ${item.id}`}
              onSelect={() => onPick(item.id)}
              className="cursor-pointer"
            >
              <FieldIcon type={item.type} />
              <FieldName label={label(item.id)} hint={hintOf(item.id)} />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** A field's name with its one-line description under it. */
function FieldName({ label, hint }: { label: string; hint: string | null }) {
  if (!hint) return <>{label}</>;
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </span>
  );
}

function defaultOp(field: FieldDef): FilterOp {
  return field.type === 'date' ? 'previous' : 'is';
}

function FilterForm({
  source,
  field,
  initial,
  valueOptions,
  onBack,
  onSubmit,
  onCancel,
}: {
  source: QuestionSource;
  field: FieldDef;
  initial?: QuestionFilter;
  valueOptions: FieldValueOptions;
  onBack?: () => void;
  onSubmit: (filter: QuestionFilter) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [op, setOp] = useState<FilterOp>(initial?.op ?? defaultOp(field));
  const [values, setValues] = useState<FilterValue[]>(
    initial?.values ?? (field.type === 'boolean' ? [true] : [])
  );
  const [text, setText] = useState<string[]>(() =>
    (initial?.values ?? []).map((value) => String(value))
  );
  const [amount, setAmount] = useState(String(initial?.amount ?? 30));
  const [unit, setUnit] = useState<RelativeUnit>(initial?.unit ?? 'day');
  const [includeCurrent, setIncludeCurrent] = useState(initial?.includeCurrent ?? true);

  const options = field.valueKind ? valueOptions(field.valueKind) : [];
  const currentUnit = unitLabel(unit, 1);
  const listMode =
    (op === 'is' || op === 'isNot') &&
    (field.type === 'entity' || field.type === 'text') &&
    options.length > 0;

  const draft = useMemo((): QuestionFilter | null => {
    const raw: Record<string, unknown> = { field: field.id, op, values: [] };
    if (op === 'isEmpty' || op === 'notEmpty') return normalizeFilter(source, raw);
    if (field.type === 'boolean') raw.values = values;
    else if (op === 'previous') {
      Object.assign(raw, { amount: Number(amount), unit, includeCurrent });
    } else if (op === 'current') raw.unit = unit === 'day' ? 'month' : unit;
    else if (listMode) raw.values = values;
    else raw.values = text.filter((value) => value.trim() !== '');
    return normalizeFilter(source, raw);
  }, [source, field.id, field.type, op, values, text, amount, unit, includeCurrent, listMode]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft) onSubmit(draft);
  };
  // Enter applies from anywhere in the form (lists and selects use it to pick,
  // so there it takes Ctrl / ⌘ + Enter).
  const formRef = useRef<HTMLFormElement | null>(null);
  const latest = useRef({ draft, onSubmit });
  useEffect(() => {
    latest.current = { draft, onSubmit };
  });
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const target = event.target as HTMLElement;
      const picking =
        target.closest('[cmdk-root], [role="combobox"], [role="listbox"]') !== null ||
        target.tagName === 'BUTTON';
      if (picking && !event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      const { draft: current, onSubmit: submitFilter } = latest.current;
      if (current) submitFilter(current);
    };
    form.addEventListener('keydown', onKeyDown);
    return () => form.removeEventListener('keydown', onKeyDown);
  }, []);

  const changeOp = (next: FilterOp) => {
    setOp(next);
    if (next === 'current' && unit === 'day') setUnit('month');
  };

  const textInput = (index: number, label: string, type: 'text' | 'number' | 'date') => (
    <Input
      id={`${id}-v${index}`}
      type={type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      step={type === 'number' ? 'any' : undefined}
      aria-label={label}
      value={text[index] ?? ''}
      onChange={(event) =>
        setText((previous) => {
          const next = [...previous];
          next[index] = event.target.value;
          return next;
        })
      }
      autoFocus={index === 0}
    />
  );

  const valueEditor = () => {
    if (op === 'isEmpty' || op === 'notEmpty') return null;
    if (field.type === 'boolean') {
      return (
        <div className="flex gap-2" role="radiogroup" aria-label={t`Value`}>
          {[true, false].map((value) => (
            <Button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={values[0] === value}
              variant={values[0] === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setValues([value])}
            >
              {booleanLabel(value)}
            </Button>
          ))}
        </div>
      );
    }
    if (field.type === 'date') {
      if (op === 'previous' || op === 'current') {
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              {op === 'previous' && (
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  inputMode="numeric"
                  aria-label={t`How many`}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="w-20"
                  autoFocus
                />
              )}
              <Select value={unit} onValueChange={(next) => setUnit(next as RelativeUnit)}>
                <SelectTrigger aria-label={t`Unit`} className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIVE_UNITS.filter((item) => op === 'previous' || item !== 'day').map(
                    (item) => (
                      <SelectItem key={item} value={item}>
                        {unitLabel(item, op === 'previous' ? Number(amount) || 2 : 1)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            {op === 'previous' && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-current`}
                  checked={includeCurrent}
                  onCheckedChange={(checked) => setIncludeCurrent(checked === true)}
                />
                <Label htmlFor={`${id}-current`} className="text-sm font-normal">
                  {unit === 'day' ? (
                    <Trans>Include today</Trans>
                  ) : (
                    <Trans>Include the current {currentUnit}</Trans>
                  )}
                </Label>
              </div>
            )}
          </div>
        );
      }
      if (op === 'between') {
        return (
          <div className="grid grid-cols-2 gap-2">
            {textInput(0, t`From`, 'date')}
            {textInput(1, t`To`, 'date')}
          </div>
        );
      }
      return textInput(0, t`Date`, 'date');
    }
    if (field.type === 'number') {
      if (op === 'between') {
        return (
          <div className="grid grid-cols-2 gap-2">
            {textInput(0, t`Minimum`, 'number')}
            {textInput(1, t`Maximum`, 'number')}
          </div>
        );
      }
      return textInput(0, t`Value`, 'number');
    }
    if (listMode) {
      return (
        <ValueChecklist
          label={fieldLabel(source, field.id)}
          options={options}
          selected={values as (string | number)[]}
          onChange={setValues}
        />
      );
    }
    return textInput(0, t`Value`, 'text');
  };

  return (
    <form ref={formRef} onSubmit={submit} className="w-full space-y-3 p-3">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onBack}
            aria-label={t`Choose another field`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        )}
        <span className="text-sm font-semibold">{fieldLabel(source, field.id)}</span>
      </div>
      {field.type === 'date' && (
        <div className="-mx-3 -mt-1">
          <QuickDateRanges
            field={field}
            current={{ op, unit, amount: Number(amount), includeCurrent }}
            onPick={(range) => onSubmit({ field: field.id, values: [], ...range })}
          />
        </div>
      )}
      {operatorsFor(field).length > 1 && (
        <Select value={op} onValueChange={(next) => changeOp(next as FilterOp)}>
          <SelectTrigger aria-label={t`Condition`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operatorsFor(field).map((item) => (
              <SelectItem key={item} value={item}>
                {operatorLabel(item, field.type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {valueEditor()}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" size="sm" disabled={!draft}>
          {initial ? t`Update filter` : t`Add filter`}
        </Button>
      </div>
    </form>
  );
}

/** Inline searchable checklist (inside the filter popover, so no nested popover). */
function ValueChecklist({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string | number; label: string; group?: string }[];
  selected: (string | number)[];
  onChange: (values: (string | number)[]) => void;
}) {
  const { t } = useLingui();
  const selectedSet = new Set(selected);
  const selectedCount = selected.length;
  const groups = new Map<string, typeof options>();
  for (const option of options) {
    const key = option.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  const toggle = (value: string | number) =>
    onChange(
      selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]
    );

  return (
    <div className="rounded-md border">
      <Command>
        <CommandInput placeholder={t`Search…`} aria-label={t`Search ${label}`} autoFocus />
        <CommandList className="max-h-56">
          <CommandEmpty>
            <Trans>No matches.</Trans>
          </CommandEmpty>
          {Array.from(groups.entries()).map(([heading, items]) => (
            <CommandGroup key={heading || '__all__'} heading={heading || undefined}>
              {items.map((option) => {
                const isSelected = selectedSet.has(option.value);
                return (
                  <CommandItem
                    key={String(option.value)}
                    value={`${option.label} ${heading} ${String(option.value)}`}
                    onSelect={() => toggle(option.value)}
                    aria-selected={isSelected}
                    className="cursor-pointer"
                  >
                    <Check
                      aria-hidden
                      className={cn('h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{option.label}</span>
                    {isSelected && (
                      <span className="sr-only">
                        <Trans>(selected)</Trans>
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
      {selected.length > 0 && (
        <div className="flex items-center justify-between border-t px-2 py-1 text-xs text-muted-foreground">
          <span>{plural(selectedCount, { one: '# selected', other: '# selected' })}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={() => onChange([])}
          >
            <Trans>Clear</Trans>
          </Button>
        </div>
      )}
    </div>
  );
}
