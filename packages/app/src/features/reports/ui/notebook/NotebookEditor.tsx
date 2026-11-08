import { Trans, useLingui } from '@lingui/react/macro';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Database,
  Filter,
  FunctionSquare,
  ListOrdered,
  MoreHorizontal,
  Plus,
  Sigma,
  SortAsc,
  X,
} from 'lucide-react';
import {
  DATE_BUCKETS,
  DEFAULT_RAW_COLUMNS,
  FRIENDLY_AGGREGATIONS,
  MAX_AGGREGATIONS,
  MAX_BREAKOUTS,
  MAX_CUSTOM_COLUMNS,
  MAX_QUESTION_LIMIT,
  NUMERIC_AGGREGATIONS,
  QUESTION_SOURCES,
  SOURCE_FIELDS,
  createQuestion,
  customFields,
  getField,
  groupableFields,
  hasDateBreakout,
  nextCustomColumnId,
  normalizeQuestion,
  numericFields,
  questionColumns,
  questionField,
  type DateBucket,
  type FieldDef,
  type QuestionAggregation,
  type QuestionBreakout,
  type QuestionCustomColumn,
  type QuestionFilter,
  type QuestionSource,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
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
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { cn } from '@shared/lib/utils';
import { FieldList, FilterEditor } from './FilterEditor';
import { ExpressionEditor } from './ExpressionEditor';
import {
  aggregationHint,
  aggregationLabel,
  bucketLabel,
  booleanLabel,
  columnLabel,
  filterSummary,
  sourceDescription,
  sourceLabel,
  specFieldLabel,
  withModifierLabel,
} from './question-labels';
import type { FieldValueOptions } from './useFieldValueOptions';

type OptionalStep = 'filter' | 'summarize' | 'sort' | 'limit';

interface NotebookEditorProps {
  spec: QuestionSpec;
  onChange: (spec: QuestionSpec) => void;
  valueOptions: FieldValueOptions;
}

/**
 * Metabase-style notebook: stacked Data → Filter → Summarize → Sort → Limit
 * steps. Optional steps are added from the buttons under the last block and
 * removed with their ✕; every edit produces a new normalized spec.
 */
export function NotebookEditor({ spec, onChange, valueOptions }: NotebookEditorProps) {
  const { t } = useLingui();
  const [opened, setOpened] = useState<Set<OptionalStep>>(new Set());
  const update = (patch: Partial<QuestionSpec>) =>
    onChange(normalizeQuestion({ ...spec, ...patch }));

  const visible: Record<OptionalStep, boolean> = {
    filter: spec.filters.length > 0 || opened.has('filter'),
    summarize: spec.aggregations.length > 0 || opened.has('summarize'),
    sort: spec.sort.length > 0 || opened.has('sort'),
    limit: spec.limit !== null || opened.has('limit'),
  };
  const open = (step: OptionalStep) => setOpened((previous) => new Set(previous).add(step));
  const close = (step: OptionalStep, patch: Partial<QuestionSpec>) => {
    setOpened((previous) => {
      const next = new Set(previous);
      next.delete(step);
      return next;
    });
    update(patch);
  };

  const addButtons: { step: OptionalStep; label: string; icon: typeof Filter }[] = [
    { step: 'filter', label: t`Filter`, icon: Filter },
    { step: 'summarize', label: t`Summarize`, icon: Sigma },
    { step: 'sort', label: t`Sort`, icon: SortAsc },
    { step: 'limit', label: t`Limit`, icon: ListOrdered },
  ];
  const hiddenSteps = addButtons.filter(({ step }) => !visible[step]);

  return (
    <div className="min-w-0 space-y-3">
      <ol className="space-y-3" aria-label={t`Question steps`}>
        <NotebookStep title={t`Data`} icon={Database} tone="data">
          <DataStep
            spec={spec}
            onSourceChange={(source) => {
              setOpened(new Set());
              onChange(createQuestion(source));
            }}
            onColumnsChange={(columns) => update({ columns })}
            onChange={update}
          />
        </NotebookStep>

        {visible.filter && (
          <NotebookStep
            title={t`Filter`}
            icon={Filter}
            tone="filter"
            onRemove={() => close('filter', { filters: [] })}
          >
            <FilterStep
              spec={spec}
              valueOptions={valueOptions}
              onChange={(filters) => update({ filters })}
              autoOpen={spec.filters.length === 0}
            />
          </NotebookStep>
        )}

        {visible.summarize && (
          <NotebookStep
            title={t`Summarize`}
            icon={Sigma}
            tone="summarize"
            onRemove={() => close('summarize', { aggregations: [], breakouts: [], sort: [] })}
          >
            <SummarizeStep spec={spec} onChange={update} />
          </NotebookStep>
        )}

        {visible.sort && (
          <NotebookStep
            title={t`Sort`}
            icon={SortAsc}
            tone="sort"
            onRemove={() => close('sort', { sort: [] })}
          >
            <SortStep spec={spec} onChange={(sort) => update({ sort })} />
          </NotebookStep>
        )}

        {visible.limit && (
          <NotebookStep
            title={t`Limit`}
            icon={ListOrdered}
            tone="limit"
            onRemove={() => close('limit', { limit: null })}
          >
            <LimitStep spec={spec} onChange={(limit) => update({ limit })} />
          </NotebookStep>
        )}
      </ol>

      {hiddenSteps.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-1" role="group" aria-label={t`Add a step`}>
          {hiddenSteps.map(({ step, label, icon: Icon }) => (
            <Button key={step} variant="outline" size="sm" onClick={() => open(step)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const TONES = {
  data: 'border-l-chart-1',
  filter: 'border-l-chart-2',
  summarize: 'border-l-chart-3',
  sort: 'border-l-chart-4',
  limit: 'border-l-chart-5',
} as const;

function NotebookStep({
  title,
  icon: Icon,
  tone,
  onRemove,
  children,
}: {
  title: string;
  icon: typeof Filter;
  tone: keyof typeof TONES;
  onRemove?: () => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <li
      className={cn(
        'min-w-0 rounded-lg border border-l-4 bg-card p-3 text-card-foreground shadow-xs',
        TONES[tone]
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {title}
        </h3>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRemove}
            aria-label={t`Remove ${title} step`}
            title={t`Remove ${title} step`}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
      {children}
    </li>
  );
}

/** A removable pill; clicking the label edits it. */
function Chip({
  label,
  onEdit,
  onRemove,
  editLabel,
  removeLabel,
  children,
}: {
  label: string;
  onEdit?: () => void;
  onRemove: () => void;
  editLabel?: string;
  removeLabel: string;
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-0.5 rounded-full border bg-secondary py-0.5 pl-3 pr-1 text-sm text-secondary-foreground">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          className="truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="ml-0.5 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

function AddButton({ label, ...props }: { label: string } & ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 rounded-full border border-dashed px-3 text-muted-foreground hover:text-foreground"
      {...props}
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function DataStep({
  spec,
  onSourceChange,
  onColumnsChange,
  onChange,
}: {
  spec: QuestionSpec;
  onSourceChange: (source: QuestionSource) => void;
  onColumnsChange: (columns: string[] | null) => void;
  onChange: (patch: Partial<QuestionSpec>) => void;
}) {
  const { t } = useLingui();
  const raw = spec.aggregations.length === 0;
  const columns = spec.columns ?? [...DEFAULT_RAW_COLUMNS[spec.source]];
  const columnCount = columns.length;
  const customColumns = spec.customColumns ?? [];
  const pickable = [
    ...SOURCE_FIELDS[spec.source].map((field) => field.id),
    ...customColumns.map((column) => column.id),
  ];
  const toggleColumn = (fieldId: string, checked: boolean) => {
    const next = checked
      ? pickable.filter((id) => id === fieldId || columns.includes(id))
      : columns.filter((id) => id !== fieldId);
    if (next.length > 0) onColumnsChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={spec.source}
          onValueChange={(next) => onSourceChange(next as QuestionSource)}
        >
          <SelectTrigger aria-label={t`Data source`} className="h-9 min-w-44 font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUESTION_SOURCES.map((source) => (
              <SelectItem key={source} value={source}>
                {sourceLabel(source)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {raw && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Columns3 className="h-4 w-4" aria-hidden />
                <Trans>Columns ({columnCount})</Trans>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <fieldset className="space-y-1">
                <legend className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
                  <Trans>Columns to show</Trans>
                </legend>
                {pickable.map((fieldId) => {
                  const id = `column-${fieldId}`;
                  const checked = columns.includes(fieldId);
                  return (
                    <div key={fieldId} className="flex items-center gap-2 rounded px-1 py-1">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={checked && columns.length === 1}
                        onCheckedChange={(value) => toggleColumn(fieldId, value === true)}
                      />
                      <Label htmlFor={id} className="font-normal">
                        {specFieldLabel(spec, fieldId)}
                      </Label>
                    </div>
                  );
                })}
              </fieldset>
              {spec.columns && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full"
                  onClick={() => onColumnsChange(null)}
                >
                  <Trans>Reset to default columns</Trans>
                </Button>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
      <CustomColumns spec={spec} onChange={onChange} />
      <p className="text-xs text-muted-foreground">{sourceDescription(spec.source)}</p>
      {spec.source === 'budget' && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Available isn’t offered here: it depends on carry-over and credit card rules that only
            the Budget page applies.
          </Trans>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

function FilterStep({
  spec,
  valueOptions,
  onChange,
  autoOpen,
}: {
  spec: QuestionSpec;
  valueOptions: FieldValueOptions;
  onChange: (filters: QuestionFilter[]) => void;
  autoOpen: boolean;
}) {
  const { t } = useLingui();
  // -1 = adding a new filter; null = closed.
  const [editing, setEditing] = useState<number | null>(autoOpen ? -1 : null);

  const nameOf = (filter: QuestionFilter) => {
    const field = getField(spec.source, filter.field);
    const options = field?.valueKind ? valueOptions(field.valueKind) : [];
    const names = new Map(options.map((option) => [String(option.value), option.label]));
    const custom = field ? undefined : questionField(spec, filter.field);
    return filterSummary(
      spec.source,
      filter,
      (value) =>
        typeof value === 'boolean'
          ? booleanLabel(value)
          : (names.get(String(value)) ?? String(value)),
      custom ? { field: custom, name: specFieldLabel(spec, filter.field) } : undefined
    );
  };

  const submit = (filter: QuestionFilter) => {
    if (editing === null) return;
    onChange(
      editing === -1
        ? [...spec.filters, filter]
        : spec.filters.map((item, index) => (index === editing ? filter : item))
    );
    setEditing(null);
  };

  const editor = (index: number) => (
    <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
      <FilterEditor
        source={spec.source}
        initial={index >= 0 ? spec.filters[index] : undefined}
        valueOptions={valueOptions}
        onSubmit={submit}
        onCancel={() => setEditing(null)}
      />
    </PopoverContent>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {spec.filters.map((filter, index) => {
        const label = nameOf(filter);
        return (
          <Popover
            key={index}
            open={editing === index}
            onOpenChange={(isOpen) => setEditing(isOpen ? index : null)}
          >
            <PopoverAnchor asChild>
              <span className="inline-flex min-w-0 max-w-full">
                <Chip
                  label={label}
                  editLabel={t`Edit filter: ${label}`}
                  // Filters on custom columns come from drill-through; they can be removed.
                  onEdit={getField(spec.source, filter.field) ? () => setEditing(index) : undefined}
                  onRemove={() => {
                    setEditing(null);
                    onChange(spec.filters.filter((_, i) => i !== index));
                  }}
                  removeLabel={t`Remove filter: ${label}`}
                />
              </span>
            </PopoverAnchor>
            {editor(index)}
          </Popover>
        );
      })}
      <Popover open={editing === -1} onOpenChange={(isOpen) => setEditing(isOpen ? -1 : null)}>
        <PopoverTrigger asChild>
          <AddButton label={t`Add filter`} />
        </PopoverTrigger>
        {editor(-1)}
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------

function MetricPicker({
  spec,
  onPick,
  onCustom,
}: {
  spec: QuestionSpec;
  onPick: (aggregation: QuestionAggregation) => void;
  onCustom: () => void;
}) {
  const { t } = useLingui();
  const { source } = spec;
  const custom = Array.from(customFields(source, spec.customColumns).values());
  const numbers: { field: FieldDef; name?: string }[] = [
    ...numericFields(source).map((field) => ({ field })),
    ...custom
      .filter((entry) => entry.field.type === 'number')
      .map((entry) => ({ field: entry.field, name: entry.column.name })),
  ];
  const distinctFields: { field: FieldDef; name?: string }[] = [
    ...SOURCE_FIELDS[source].filter((field) => field.type !== 'number').map((field) => ({ field })),
    ...custom
      .filter((entry) => entry.field.type !== 'number')
      .map((entry) => ({ field: entry.field, name: entry.column.name })),
  ];
  const item = (aggregation: QuestionAggregation, hint?: string | null, fieldName?: string) => {
    const label = aggregationLabel(source, aggregation, fieldName);
    return (
      <CommandItem
        key={`${aggregation.op}-${aggregation.field ?? ''}`}
        value={`${label} ${aggregation.op} ${aggregation.field ?? ''}`}
        onSelect={() => onPick(aggregation)}
        className="cursor-pointer flex-col items-start gap-0"
      >
        <span>{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CommandItem>
    );
  };
  return (
    <Command>
      <CommandInput placeholder={t`Pick a metric…`} aria-label={t`Find a metric`} />
      <CommandList className="max-h-80">
        <CommandEmpty>
          <Trans>No matching metrics.</Trans>
        </CommandEmpty>
        {source === 'transactions' && (
          <CommandGroup heading={t`Budget metrics`}>
            {FRIENDLY_AGGREGATIONS.map((op) => item({ op }, aggregationHint(op)))}
          </CommandGroup>
        )}
        <CommandGroup heading={t`Basic metrics`}>
          {item({ op: 'count' })}
          {NUMERIC_AGGREGATIONS.flatMap((op) =>
            numbers.map(({ field, name }) => item({ op, field: field.id }, null, name))
          )}
        </CommandGroup>
        <CommandGroup heading={t`Distinct values`}>
          {distinctFields.map(({ field, name }) =>
            item({ op: 'distinct', field: field.id }, null, name)
          )}
        </CommandGroup>
        <CommandGroup heading={t`Custom`}>
          <CommandItem
            value={`${t`Custom metric`} custom expression formula`}
            onSelect={onCustom}
            className="cursor-pointer flex-col items-start gap-0"
          >
            <span className="flex items-center gap-1.5">
              <FunctionSquare className="h-4 w-4" aria-hidden />
              <Trans>Custom metric…</Trans>
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>Write a formula, e.g. Spending / Income * 100</Trans>
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

const MOVING_WINDOWS = [3, 6, 12] as const;

/** "…" menu on a metric chip: compare to the previous period, running total, moving average, % of total. */
function MetricOptions({
  spec,
  aggregation,
  label,
  onChange,
}: {
  spec: QuestionSpec;
  aggregation: QuestionAggregation;
  label: string;
  onChange: (aggregation: QuestionAggregation) => void;
}) {
  const { t } = useLingui();
  const dated = hasDateBreakout(spec.breakouts);
  const grouped = spec.breakouts.length > 0;
  const value =
    aggregation.modifier === 'moving'
      ? `moving:${aggregation.window ?? 3}`
      : (aggregation.modifier ?? 'none');
  const setModifier = (next: string) => {
    const { modifier: _modifier, window: _window, ...rest } = aggregation;
    if (next === 'none') onChange(rest);
    else if (next.startsWith('moving:')) {
      onChange({ ...rest, modifier: 'moving', window: Number(next.slice(7)) });
    } else onChange({ ...rest, modifier: next as QuestionAggregation['modifier'] });
  };
  const active = Boolean(aggregation.modifier || aggregation.compare);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t`Options for ${label}`}
          title={t`Compare, running total, moving average, % of total`}
          className={cn(
            'ml-0.5 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'text-primary'
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuCheckboxItem
          checked={Boolean(aggregation.compare)}
          disabled={!dated}
          onCheckedChange={(checked) => {
            const { compare: _compare, ...rest } = aggregation;
            onChange(checked ? { ...rest, compare: true } : rest);
          }}
        >
          <Trans>Compare to previous period</Trans>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          <Trans>Show as</Trans>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={setModifier}>
          <DropdownMenuRadioItem value="none">
            <Trans>Value</Trans>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="running" disabled={!dated}>
            <Trans>Running total</Trans>
          </DropdownMenuRadioItem>
          {MOVING_WINDOWS.map((window) => (
            <DropdownMenuRadioItem key={window} value={`moving:${window}`} disabled={!dated}>
              <Trans>Moving average ({window} periods)</Trans>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value="share" disabled={!grouped}>
            <Trans>% of total</Trans>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {!dated && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            <Trans>Group by a date to compare periods or add running totals.</Trans>
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Custom column chips (edit / remove) and "+ Custom column" in the Data step. */
function CustomColumns({
  spec,
  onChange,
}: {
  spec: QuestionSpec;
  onChange: (patch: Partial<QuestionSpec>) => void;
}) {
  const { t } = useLingui();
  // A column id, 'new', or null.
  const [editing, setEditing] = useState<string | null>(null);
  const customColumns = spec.customColumns ?? [];
  const raw = spec.aggregations.length === 0;

  const save = (column: QuestionCustomColumn) => {
    const exists = customColumns.some((item) => item.id === column.id);
    const next = exists
      ? customColumns.map((item) => (item.id === column.id ? column : item))
      : [...customColumns, column];
    // A new column shows up in raw rows right away.
    const columns =
      !exists && raw
        ? [...(spec.columns ?? DEFAULT_RAW_COLUMNS[spec.source]), column.id]
        : undefined;
    onChange({ customColumns: next, ...(columns ? { columns } : {}) });
    setEditing(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Custom columns`}>
      {customColumns.map((column) => (
        <Popover
          key={column.id}
          open={editing === column.id}
          onOpenChange={(isOpen) => setEditing(isOpen ? column.id : null)}
        >
          <PopoverAnchor asChild>
            <span className="inline-flex min-w-0 max-w-full">
              <Chip
                label={column.name}
                editLabel={t`Edit custom column: ${column.name}`}
                onEdit={() => setEditing(column.id)}
                onRemove={() =>
                  onChange({
                    customColumns: customColumns.filter((item) => item.id !== column.id),
                  })
                }
                removeLabel={t`Remove custom column: ${column.name}`}
              />
            </span>
          </PopoverAnchor>
          <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
            <ExpressionEditor
              spec={spec}
              kind="column"
              initial={column}
              onSubmit={({ name, expression }) => save({ id: column.id, name, expression })}
              onCancel={() => setEditing(null)}
            />
          </PopoverContent>
        </Popover>
      ))}
      {customColumns.length < MAX_CUSTOM_COLUMNS && (
        <Popover
          open={editing === 'new'}
          onOpenChange={(isOpen) => setEditing(isOpen ? 'new' : null)}
        >
          <PopoverTrigger asChild>
            <AddButton label={t`Custom column`} />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
            <ExpressionEditor
              spec={spec}
              kind="column"
              onSubmit={({ name, expression }) =>
                save({ id: nextCustomColumnId(spec), name, expression })
              }
              onCancel={() => setEditing(null)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function SummarizeStep({
  spec,
  onChange,
}: {
  spec: QuestionSpec;
  onChange: (patch: Partial<QuestionSpec>) => void;
}) {
  const { t } = useLingui();
  // -1 adds; an index replaces.
  const [metricOpen, setMetricOpen] = useState<number | null>(
    spec.aggregations.length === 0 ? -1 : null
  );
  // Which form the metric popover shows: the picker or the formula editor.
  const [metricMode, setMetricMode] = useState<'pick' | 'custom'>('pick');
  const [groupOpen, setGroupOpen] = useState(false);
  const custom = customFields(spec.source, spec.customColumns);
  const groupable = [
    ...groupableFields(spec.source),
    ...Array.from(custom.values()).map((entry) => entry.field),
  ];
  const labelOf = (fieldId: string) => specFieldLabel(spec, fieldId);

  const openMetric = (index: number | null) => {
    setMetricOpen(index);
    const current = index !== null && index >= 0 ? spec.aggregations[index] : undefined;
    setMetricMode(current?.op === 'custom' ? 'custom' : 'pick');
  };

  const pickMetric = (aggregation: QuestionAggregation) => {
    if (metricOpen === null) return;
    const previous = metricOpen >= 0 ? spec.aggregations[metricOpen] : undefined;
    // Swapping the metric keeps its comparison / running-total choice.
    const next: QuestionAggregation = {
      ...aggregation,
      ...(previous?.modifier ? { modifier: previous.modifier } : {}),
      ...(previous?.window ? { window: previous.window } : {}),
      ...(previous?.compare ? { compare: true } : {}),
    };
    onChange({
      aggregations:
        metricOpen === -1
          ? [...spec.aggregations, next]
          : spec.aggregations.map((item, index) => (index === metricOpen ? next : item)),
    });
    setMetricOpen(null);
  };

  const setAggregation = (index: number, aggregation: QuestionAggregation) =>
    onChange({
      aggregations: spec.aggregations.map((item, i) => (i === index ? aggregation : item)),
    });

  const pickGroup = (fieldId: string) => {
    const field = questionField(spec, fieldId);
    if (!field) return;
    const breakout: QuestionBreakout =
      field.type === 'date'
        ? { field: field.id, bucket: field.defaultBucket ?? 'month' }
        : { field: field.id };
    onChange({ breakouts: [...spec.breakouts, breakout] });
    setGroupOpen(false);
  };

  const setBucket = (index: number, bucket: DateBucket) =>
    onChange({
      breakouts: spec.breakouts.map((item, i) => (i === index ? { ...item, bucket } : item)),
    });

  const metricPopover = (index: number) => {
    const current = index >= 0 ? spec.aggregations[index] : undefined;
    return (
      <PopoverContent
        align="start"
        className={cn(
          'p-0',
          metricMode === 'custom'
            ? 'w-[min(24rem,calc(100vw-2rem))]'
            : 'w-[min(20rem,calc(100vw-2rem))]'
        )}
      >
        {metricMode === 'custom' ? (
          <ExpressionEditor
            spec={spec}
            kind="metric"
            initial={
              current?.op === 'custom' && current.expression
                ? { name: current.name, expression: current.expression }
                : undefined
            }
            onSubmit={({ name, expression }) => pickMetric({ op: 'custom', name, expression })}
            onCancel={() => setMetricOpen(null)}
            onBack={() => setMetricMode('pick')}
          />
        ) : (
          <MetricPicker spec={spec} onPick={pickMetric} onCustom={() => setMetricMode('custom')} />
        )}
      </PopoverContent>
    );
  };

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Metrics`}>
        {spec.aggregations.map((aggregation, index) => {
          const fieldName = aggregation.field
            ? custom.get(aggregation.field)?.column.name
            : undefined;
          const base = withModifierLabel(
            aggregationLabel(spec.source, aggregation, fieldName),
            aggregation
          );
          const label = aggregation.compare ? t`${base} vs previous period` : base;
          return (
            <Popover
              key={index}
              open={metricOpen === index}
              onOpenChange={(isOpen) => openMetric(isOpen ? index : null)}
            >
              <PopoverAnchor asChild>
                <span className="inline-flex min-w-0 max-w-full">
                  <Chip
                    label={label}
                    editLabel={t`Change metric: ${label}`}
                    onEdit={() => openMetric(index)}
                    onRemove={() => {
                      setMetricOpen(null);
                      onChange({ aggregations: spec.aggregations.filter((_, i) => i !== index) });
                    }}
                    removeLabel={t`Remove metric: ${label}`}
                  >
                    <MetricOptions
                      spec={spec}
                      aggregation={aggregation}
                      label={label}
                      onChange={(next) => setAggregation(index, next)}
                    />
                  </Chip>
                </span>
              </PopoverAnchor>
              {metricPopover(index)}
            </Popover>
          );
        })}
        {spec.aggregations.length < MAX_AGGREGATIONS && (
          <Popover
            open={metricOpen === -1}
            onOpenChange={(isOpen) => openMetric(isOpen ? -1 : null)}
          >
            <PopoverTrigger asChild>
              <AddButton
                label={spec.aggregations.length === 0 ? t`Pick a metric` : t`Add metric`}
              />
            </PopoverTrigger>
            {metricPopover(-1)}
          </Popover>
        )}
      </div>

      <span className="self-center text-sm text-muted-foreground">
        <Trans>by</Trans>
      </span>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Groupings`}>
        {spec.breakouts.map((breakout, index) => {
          const field = questionField(spec, breakout.field);
          const label = labelOf(breakout.field);
          return (
            <Chip
              key={`${breakout.field}-${breakout.bucket ?? ''}`}
              label={label}
              onRemove={() => onChange({ breakouts: spec.breakouts.filter((_, i) => i !== index) })}
              removeLabel={t`Remove grouping: ${label}`}
            >
              {field?.type === 'date' && breakout.bucket && (
                <Select
                  value={breakout.bucket}
                  onValueChange={(value) => setBucket(index, value as DateBucket)}
                >
                  <SelectTrigger
                    aria-label={t`${label} granularity`}
                    className="ml-1 h-6 gap-1 border-0 bg-background px-2 text-xs shadow-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_BUCKETS.filter((bucket) => field.buckets?.includes(bucket)).map(
                      (bucket) => (
                        <SelectItem key={bucket} value={bucket}>
                          {bucketLabel(bucket)}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              )}
            </Chip>
          );
        })}
        {spec.breakouts.length < MAX_BREAKOUTS && (
          <Popover open={groupOpen} onOpenChange={setGroupOpen}>
            <PopoverTrigger asChild>
              <AddButton
                label={spec.breakouts.length === 0 ? t`Pick a grouping` : t`Add grouping`}
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] p-0">
              <FieldList
                source={spec.source}
                fields={groupable}
                onPick={pickGroup}
                placeholder={t`Group by…`}
                labelOf={labelOf}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort / Limit
// ---------------------------------------------------------------------------

function SortStep({
  spec,
  onChange,
}: {
  spec: QuestionSpec;
  onChange: (sort: QuestionSpec['sort']) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(spec.sort.length === 0);
  const columns = questionColumns(spec);
  const labelOf = (key: string) => {
    const column = columns.find((item) => item.key === key);
    return column ? columnLabel(spec.source, column) : key;
  };
  const available = columns.filter(
    (column) => !spec.sort.some((entry) => entry.column === column.key)
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {spec.sort.map((entry, index) => {
        const label = labelOf(entry.column);
        const ascending = entry.direction === 'asc';
        return (
          <Chip
            key={entry.column}
            label={label}
            onRemove={() => onChange(spec.sort.filter((_, i) => i !== index))}
            removeLabel={t`Remove sort: ${label}`}
          >
            <button
              type="button"
              onClick={() =>
                onChange(
                  spec.sort.map((item, i) =>
                    i === index ? { ...item, direction: ascending ? 'desc' : 'asc' } : item
                  )
                )
              }
              className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={
                ascending
                  ? t`${label}: ascending. Switch to descending`
                  : t`${label}: descending. Switch to ascending`
              }
            >
              {ascending ? (
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              )}
              {ascending ? t`Ascending` : t`Descending`}
            </button>
          </Chip>
        );
      })}
      {available.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <AddButton label={t`Pick a column to sort by`} />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandList className="max-h-72">
                <CommandGroup>
                  {available.map((column) => (
                    <CommandItem
                      key={column.key}
                      value={`${columnLabel(spec.source, column)} ${column.key}`}
                      onSelect={() => {
                        onChange([
                          ...spec.sort,
                          {
                            column: column.key,
                            direction: column.kind === 'aggregation' ? 'desc' : 'asc',
                          },
                        ]);
                        setOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      {columnLabel(spec.source, column)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function LimitStep({
  spec,
  onChange,
}: {
  spec: QuestionSpec;
  onChange: (limit: number | null) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(spec.limit === null ? '' : String(spec.limit));
  const groupedLimit = spec.breakouts.length > 1;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QUESTION_LIMIT}
          value={draft}
          placeholder={t`Enter a limit`}
          aria-label={t`Maximum number of rows`}
          className="h-9 w-32"
          autoFocus={spec.limit === null}
          onChange={(event) => {
            setDraft(event.target.value);
            const value = Number(event.target.value);
            if (event.target.value === '') onChange(null);
            else if (Number.isFinite(value) && value >= 1) onChange(value);
          }}
        />
        <span className="text-sm text-muted-foreground">
          {groupedLimit ? <Trans>values</Trans> : <Trans>rows</Trans>}
        </span>
      </div>
      {groupedLimit && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            With two groupings, the limit keeps the top values of the first non-date grouping.
          </Trans>
        </p>
      )}
    </div>
  );
}
