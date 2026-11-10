import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowLeftRight,
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
  DEFAULT_RAW_COLUMNS,
  FRIENDLY_AGGREGATIONS,
  MAX_AGGREGATIONS,
  MAX_BREAKOUTS,
  MAX_CUSTOM_COLUMNS,
  MAX_HAVING,
  MAX_QUESTION_LIMIT,
  NUMERIC_AGGREGATIONS,
  QUESTION_SOURCES,
  rowFields,
  createQuestion,
  customFields,
  getField,
  hasDateBreakout,
  nextCustomColumnId,
  normalizeQuestion,
  numericFields,
  questionColumns,
  questionField,
  type FieldDef,
  type QuestionAggregation,
  type QuestionBreakout,
  type QuestionCustomColumn,
  type QuestionFilter,
  type QuestionHaving,
  type QuestionSource,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import {
  DropdownMenu,
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
import { PopoverAnchor, PopoverTrigger } from '@shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { cn } from '@shared/lib/utils';
import { PickerContent, PickerRoot, SOLID_OVERLAY } from './ResponsivePicker';
import { FilterEditor } from './FilterEditor';
import { ExpressionEditor } from './ExpressionEditor';
import { GroupingPicker } from './GroupingPicker';
import { HavingEditor } from './HavingEditor';
import {
  aggregationHint,
  aggregationLabel,
  booleanLabel,
  columnLabel,
  filterSummary,
  havingSummary,
  sourceDescription,
  sourceLabel,
  specFieldLabel,
  withModifierLabel,
} from './question-labels';
import type { FieldValueOptions } from './useFieldValueOptions';

interface NotebookEditorProps {
  spec: QuestionSpec;
  onChange: (spec: QuestionSpec) => void;
  valueOptions: FieldValueOptions;
}

/** True when the question has anything beyond a fresh one for its source. */
function hasSteps(spec: QuestionSpec): boolean {
  const fresh = createQuestion(spec.source);
  return (
    JSON.stringify(spec.aggregations) !== JSON.stringify(fresh.aggregations) ||
    JSON.stringify(spec.breakouts) !== JSON.stringify(fresh.breakouts) ||
    spec.sort.length > 0 ||
    spec.limit !== null ||
    (spec.customColumns?.length ?? 0) > 0 ||
    spec.columns !== null ||
    JSON.stringify(spec.filters) !== JSON.stringify(fresh.filters)
  );
}

/**
 * Metabase-style notebook: stacked Data → Filter → Summarize → Sort → Limit
 * steps, all shown up front (empty ones are one tap from their first pill).
 * Every edit produces a new normalized spec.
 */
export function NotebookEditor({ spec, onChange, valueOptions }: NotebookEditorProps) {
  const { t } = useLingui();
  const isMobile = useIsMobile();
  const update = (patch: Partial<QuestionSpec>) =>
    onChange(normalizeQuestion({ ...spec, ...patch }));

  return (
    <div className="min-w-0 space-y-3">
      <ol className="space-y-3" aria-label={t`Question steps`}>
        <NotebookStep title={t`Data`} icon={Database} tone="data">
          <DataStep
            spec={spec}
            onSourceChange={(source) => {
              if (source === spec.source) return;
              const previous = spec;
              const next = createQuestion(source);
              onChange(next);
              // Steps only fit their own data source, so they go; one tap brings them back.
              if (hasSteps(previous)) {
                toast(t`Data source changed: the question starts over.`, {
                  action: { label: t`Undo`, onClick: () => onChange(previous) },
                });
              }
            }}
            onColumnsChange={(columns) => update({ columns })}
            onChange={update}
          />
        </NotebookStep>

        <NotebookStep
          title={t`Filter`}
          icon={Filter}
          tone="filter"
          onRemove={spec.filters.length > 0 ? () => update({ filters: [] }) : undefined}
          removeLabel={t`Remove all filters`}
        >
          <FilterStep
            spec={spec}
            valueOptions={valueOptions}
            onChange={(filters) => update({ filters })}
          />
        </NotebookStep>

        <NotebookStep
          title={t`Summarize`}
          icon={Sigma}
          tone="summarize"
          onRemove={
            spec.aggregations.length > 0
              ? () => update({ aggregations: [], breakouts: [], sort: [], having: [] })
              : undefined
          }
          removeLabel={t`Remove the summary`}
        >
          <SummarizeStep spec={spec} onChange={update} />
        </NotebookStep>

        <NotebookStep
          title={t`Sort`}
          icon={SortAsc}
          tone="sort"
          inline={spec.sort.length === 0}
          onRemove={spec.sort.length > 0 ? () => update({ sort: [] }) : undefined}
          removeLabel={t`Remove sorting`}
        >
          <SortStep spec={spec} onChange={(sort) => update({ sort })} />
        </NotebookStep>

        <NotebookStep
          title={t`Limit`}
          icon={ListOrdered}
          tone="limit"
          // Phones: the title on top keeps the limit chips on one row.
          inline={spec.limit === null && !isMobile}
          onRemove={spec.limit !== null ? () => update({ limit: null }) : undefined}
          removeLabel={t`Remove the limit`}
        >
          <LimitStep spec={spec} onChange={(limit) => update({ limit })} />
        </NotebookStep>
      </ol>
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
  removeLabel,
  inline = false,
  children,
}: {
  title: string;
  icon: typeof Filter;
  tone: keyof typeof TONES;
  /** Clears the step; omit when it is empty. */
  onRemove?: () => void;
  removeLabel?: string;
  /** An empty step: title and its first button on one line, to keep the notebook short. */
  inline?: boolean;
  children: ReactNode;
}) {
  // One tree for both layouts, so typing that fills an empty step keeps focus.
  return (
    <li
      className={cn(
        'min-w-0 rounded-lg border border-l-4 bg-card text-card-foreground shadow-xs',
        inline ? 'flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2' : 'p-3',
        TONES[tone]
      )}
    >
      <div
        className={cn(
          'flex min-h-7 items-center justify-between gap-2',
          inline ? 'w-20 shrink-0' : 'mb-2'
        )}
      >
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
            aria-label={removeLabel ?? title}
            title={removeLabel ?? title}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
      <div className={inline ? 'min-w-0 flex-1' : undefined}>{children}</div>
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
    <span className="inline-flex max-w-full items-center gap-0.5 rounded-[1.1rem] border bg-secondary py-0.5 pl-3 pr-1 text-sm text-secondary-foreground">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          title={label}
          className="min-w-0 break-words rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      ) : (
        <span className="min-w-0 break-words" title={label}>
          {label}
        </span>
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
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columns = spec.columns ?? [...DEFAULT_RAW_COLUMNS[spec.source]];
  const columnCount = columns.length;
  const customColumns = spec.customColumns ?? [];
  const pickable = [
    ...rowFields(spec.source).map((field) => field.id),
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
          <PickerRoot open={columnsOpen} onOpenChange={setColumnsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Columns3 className="h-4 w-4" aria-hidden />
                <Trans>Columns ({columnCount})</Trans>
              </Button>
            </PopoverTrigger>
            <PickerContent title={t`Columns to show`} align="start" className="w-64 p-2">
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
            </PickerContent>
          </PickerRoot>
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
}: {
  spec: QuestionSpec;
  valueOptions: FieldValueOptions;
  onChange: (filters: QuestionFilter[]) => void;
}) {
  const { t } = useLingui();
  // -1 = adding a new filter; null = closed.
  const [editing, setEditing] = useState<number | null>(null);

  const nameOf = (filter: QuestionFilter) => {
    const field = getField(spec.source, filter.field);
    const options = field?.valueKind ? valueOptions(field.valueKind) : [];
    // Same-name values (e.g. two "Misc" categories) show their group.
    const counts = new Map<string, number>();
    for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
    const names = new Map(
      options.map((option) => [
        String(option.value),
        (counts.get(option.label) ?? 0) > 1 && option.group
          ? `${option.label} (${option.group})`
          : option.label,
      ])
    );
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
    <PickerContent title={t`Filter`} align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
      <FilterEditor
        source={spec.source}
        initial={index >= 0 ? spec.filters[index] : undefined}
        valueOptions={valueOptions}
        onSubmit={submit}
        onCancel={() => setEditing(null)}
      />
    </PickerContent>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {spec.filters.map((filter, index) => {
        const label = nameOf(filter);
        return (
          <PickerRoot
            key={index}
            open={editing === index}
            onOpenChange={(isOpen) => setEditing(isOpen ? index : null)}
          >
            <PopoverAnchor asChild>
              <span className="inline-flex min-w-0 max-w-full">
                <Chip
                  label={label}
                  editLabel={t`Edit filter: ${label}`}
                  // Filters on custom columns, date parts and ranges come from
                  // drill-through; the filter form can't edit them, only remove.
                  onEdit={
                    getField(spec.source, filter.field) &&
                    !filter.part &&
                    filter.binWidth === undefined
                      ? () => setEditing(index)
                      : undefined
                  }
                  onRemove={() => {
                    setEditing(null);
                    onChange(spec.filters.filter((_, i) => i !== index));
                  }}
                  removeLabel={t`Remove filter: ${label}`}
                />
              </span>
            </PopoverAnchor>
            {editor(index)}
          </PickerRoot>
        );
      })}
      <PickerRoot open={editing === -1} onOpenChange={(isOpen) => setEditing(isOpen ? -1 : null)}>
        <PopoverTrigger asChild>
          <AddButton label={t`Add filter`} />
        </PopoverTrigger>
        {editor(-1)}
      </PickerRoot>
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
    ...rowFields(source)
      .filter((field) => field.type !== 'number')
      .map((field) => ({ field })),
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
  const compareValue = !aggregation.compare
    ? 'off'
    : aggregation.compareTo === 'lastYear'
      ? 'lastYear'
      : 'previous';
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
      <DropdownMenuContent
        align="start"
        className={cn('w-64', SOLID_OVERLAY)}
        collisionPadding={{ top: 8, bottom: 80, left: 8, right: 8 }}
      >
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          <Trans>Compare with</Trans>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={compareValue}
          onValueChange={(next) => {
            const { compare: _compare, compareTo: _compareTo, ...rest } = aggregation;
            if (next === 'previous') onChange({ ...rest, compare: true });
            else if (next === 'lastYear')
              onChange({ ...rest, compare: true, compareTo: 'lastYear' });
            else onChange(rest);
          }}
        >
          <DropdownMenuRadioItem value="off">
            <Trans>No comparison</Trans>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="previous" disabled={!dated}>
            <Trans>Previous period</Trans>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="lastYear"
            disabled={!dated || Boolean(aggregation.modifier)}
          >
            <Trans>Same period last year</Trans>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
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
        <PickerRoot
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
          <PickerContent
            title={t`Custom column`}
            align="start"
            className="w-[min(24rem,calc(100vw-2rem))] p-0"
          >
            <ExpressionEditor
              spec={spec}
              kind="column"
              initial={column}
              onSubmit={({ name, expression }) => save({ id: column.id, name, expression })}
              onCancel={() => setEditing(null)}
            />
          </PickerContent>
        </PickerRoot>
      ))}
      {customColumns.length < MAX_CUSTOM_COLUMNS && (
        <PickerRoot
          open={editing === 'new'}
          onOpenChange={(isOpen) => setEditing(isOpen ? 'new' : null)}
        >
          <PopoverTrigger asChild>
            <AddButton label={t`Custom column`} />
          </PopoverTrigger>
          <PickerContent
            title={t`Custom column`}
            align="start"
            className="w-[min(24rem,calc(100vw-2rem))] p-0"
          >
            <ExpressionEditor
              spec={spec}
              kind="column"
              onSubmit={({ name, expression }) =>
                save({ id: nextCustomColumnId(spec), name, expression })
              }
              onCancel={() => setEditing(null)}
            />
          </PickerContent>
        </PickerRoot>
      )}
    </div>
  );
}

/** Chip text of a grouping: "Month", "Date: Week", "Day of week", "Amount (range)". */
function groupingLabel(spec: QuestionSpec, breakout: QuestionBreakout): string {
  const column = questionColumns(spec).find(
    (item) =>
      item.kind === 'breakout' &&
      item.breakout.field === breakout.field &&
      item.breakout.bucket === breakout.bucket &&
      item.breakout.part === breakout.part &&
      item.breakout.bin === breakout.bin
  );
  return column ? columnLabel(spec.source, column) : specFieldLabel(spec, breakout.field);
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
  const [metricOpen, setMetricOpen] = useState<number | null>(null);
  // Which form the metric popover shows: the picker or the formula editor.
  const [metricMode, setMetricMode] = useState<'pick' | 'custom'>('pick');
  // -1 adds; an index changes that grouping.
  const [groupOpen, setGroupOpen] = useState<number | null>(null);
  const [havingOpen, setHavingOpen] = useState<number | null>(null);
  const custom = customFields(spec.source, spec.customColumns);
  const having = spec.having ?? [];

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
      ...(previous?.compareTo ? { compareTo: previous.compareTo } : {}),
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

  const pickGroup = (breakout: QuestionBreakout) => {
    if (groupOpen === null) return;
    onChange({
      breakouts:
        groupOpen === -1
          ? [...spec.breakouts, breakout]
          : spec.breakouts.map((item, index) => (index === groupOpen ? breakout : item)),
    });
    setGroupOpen(null);
  };

  const swapGroups = (index: number) => {
    const next = [...spec.breakouts];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange({ breakouts: next });
  };

  const submitHaving = (entry: QuestionHaving) => {
    if (havingOpen === null) return;
    onChange({
      having:
        havingOpen === -1
          ? [...having, entry]
          : having.map((item, index) => (index === havingOpen ? entry : item)),
    });
    setHavingOpen(null);
  };

  const metricPopover = (index: number) => {
    const current = index >= 0 ? spec.aggregations[index] : undefined;
    return (
      <PickerContent
        title={t`Metric`}
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
      </PickerContent>
    );
  };

  const groupPopover = (index: number) => (
    <PickerContent
      title={t`Grouping`}
      align="start"
      className="w-[min(20rem,calc(100vw-2rem))] p-0"
    >
      <GroupingPicker
        spec={spec}
        initial={index >= 0 ? spec.breakouts[index] : undefined}
        onPick={pickGroup}
      />
    </PickerContent>
  );

  const havingPopover = (index: number) => (
    <PickerContent
      title={t`Filter results`}
      align="start"
      className="w-[min(20rem,calc(100vw-2rem))] p-0"
    >
      <HavingEditor
        spec={spec}
        initial={index >= 0 ? having[index] : undefined}
        onSubmit={submitHaving}
        onCancel={() => setHavingOpen(null)}
      />
    </PickerContent>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Metrics`}>
          {spec.aggregations.map((aggregation, index) => {
            const fieldName = aggregation.field
              ? custom.get(aggregation.field)?.column.name
              : undefined;
            const base = withModifierLabel(
              aggregationLabel(spec.source, aggregation, fieldName),
              aggregation
            );
            const label = !aggregation.compare
              ? base
              : aggregation.compareTo === 'lastYear'
                ? t`${base} vs last year`
                : t`${base} vs previous period`;
            return (
              <PickerRoot
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
                        onChange({
                          aggregations: spec.aggregations.filter((_, i) => i !== index),
                        });
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
              </PickerRoot>
            );
          })}
          {spec.aggregations.length < MAX_AGGREGATIONS && (
            <PickerRoot
              open={metricOpen === -1}
              onOpenChange={(isOpen) => openMetric(isOpen ? -1 : null)}
            >
              <PopoverTrigger asChild>
                <AddButton
                  label={spec.aggregations.length === 0 ? t`Pick a metric` : t`Add metric`}
                />
              </PopoverTrigger>
              {metricPopover(-1)}
            </PickerRoot>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Groupings`}>
          <span className="pr-1 text-sm text-muted-foreground">
            <Trans>by</Trans>
          </span>
          {spec.breakouts.map((breakout, index) => {
            const label = groupingLabel(spec, breakout);
            return (
              <span
                key={`${index}-${label}`}
                className="inline-flex min-w-0 max-w-full items-center gap-1"
              >
                <PickerRoot
                  open={groupOpen === index}
                  onOpenChange={(isOpen) => setGroupOpen(isOpen ? index : null)}
                >
                  <PopoverAnchor asChild>
                    <span className="inline-flex min-w-0 max-w-full">
                      <Chip
                        label={label}
                        editLabel={t`Change grouping: ${label}`}
                        onEdit={() => setGroupOpen(index)}
                        onRemove={() => {
                          setGroupOpen(null);
                          onChange({ breakouts: spec.breakouts.filter((_, i) => i !== index) });
                        }}
                        removeLabel={t`Remove grouping: ${label}`}
                      />
                    </span>
                  </PopoverAnchor>
                  {groupPopover(index)}
                </PickerRoot>
                {index < spec.breakouts.length - 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-full"
                    onClick={() => swapGroups(index)}
                    aria-label={t`Swap the groupings`}
                    title={t`Swap the groupings`}
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </span>
            );
          })}
          {spec.breakouts.length < MAX_BREAKOUTS && (
            <PickerRoot
              open={groupOpen === -1}
              onOpenChange={(isOpen) => setGroupOpen(isOpen ? -1 : null)}
            >
              <PopoverTrigger asChild>
                <AddButton
                  label={spec.breakouts.length === 0 ? t`Pick a grouping` : t`Add grouping`}
                />
              </PopoverTrigger>
              {groupPopover(-1)}
            </PickerRoot>
          )}
        </div>
      </div>

      {spec.aggregations.length > 0 && spec.breakouts.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 border-t pt-3"
          role="group"
          aria-label={t`Filter results`}
        >
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Only show results where</Trans>
          </span>
          {having.map((entry, index) => {
            const label = havingSummary(spec, entry);
            return (
              <PickerRoot
                key={index}
                open={havingOpen === index}
                onOpenChange={(isOpen) => setHavingOpen(isOpen ? index : null)}
              >
                <PopoverAnchor asChild>
                  <span className="inline-flex min-w-0 max-w-full">
                    <Chip
                      label={label}
                      editLabel={t`Edit result filter: ${label}`}
                      onEdit={() => setHavingOpen(index)}
                      onRemove={() => {
                        setHavingOpen(null);
                        onChange({ having: having.filter((_, i) => i !== index) });
                      }}
                      removeLabel={t`Remove result filter: ${label}`}
                    />
                  </span>
                </PopoverAnchor>
                {havingPopover(index)}
              </PickerRoot>
            );
          })}
          {having.length < MAX_HAVING && (
            <PickerRoot
              open={havingOpen === -1}
              onOpenChange={(isOpen) => setHavingOpen(isOpen ? -1 : null)}
            >
              <PopoverTrigger asChild>
                <AddButton label={t`Filter results`} />
              </PopoverTrigger>
              {havingPopover(-1)}
            </PickerRoot>
          )}
        </div>
      )}
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
  const [open, setOpen] = useState(false);
  const columns = questionColumns(spec);
  const raw = spec.aggregations.length === 0;
  // Raw rows can sort by any field, shown or not.
  const choices: { key: string; label: string; metric: boolean }[] = raw
    ? [
        ...rowFields(spec.source).map((field) => ({
          key: field.id,
          label: specFieldLabel(spec, field.id),
          metric: false,
        })),
        ...(spec.customColumns ?? []).map((column) => ({
          key: column.id,
          label: column.name,
          metric: false,
        })),
      ]
    : columns.map((column) => ({
        key: column.key,
        label: columnLabel(spec.source, column),
        metric: column.kind === 'aggregation',
      }));
  const labelOf = (key: string) => choices.find((item) => item.key === key)?.label ?? key;
  const available = choices.filter(
    (choice) => !spec.sort.some((entry) => entry.column === choice.key)
  );
  const flip = (index: number) =>
    onChange(
      spec.sort.map((item, i) =>
        i === index ? { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' } : item
      )
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
            onEdit={() => flip(index)}
            editLabel={
              ascending
                ? t`${label}: ascending. Switch to descending`
                : t`${label}: descending. Switch to ascending`
            }
            onRemove={() => onChange(spec.sort.filter((_, i) => i !== index))}
            removeLabel={t`Remove sort: ${label}`}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => flip(index)}
              className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
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
        <PickerRoot open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <AddButton label={spec.sort.length === 0 ? t`Pick a column to sort by` : t`Add sort`} />
          </PopoverTrigger>
          <PickerContent title={t`Sort`} align="start" className="w-64 p-0">
            <Command>
              <CommandList className="max-h-72">
                <CommandGroup>
                  {available.map((choice) => (
                    <CommandItem
                      key={choice.key}
                      value={`${choice.label} ${choice.key}`}
                      onSelect={() => {
                        onChange([
                          ...spec.sort,
                          { column: choice.key, direction: choice.metric ? 'desc' : 'asc' },
                        ]);
                        setOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      {choice.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PickerContent>
        </PickerRoot>
      )}
    </div>
  );
}

const LIMIT_PRESETS = [10, 25, 100] as const;

function LimitStep({
  spec,
  onChange,
}: {
  spec: QuestionSpec;
  onChange: (limit: number | null) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(spec.limit === null ? '' : String(spec.limit));
  // Cleared from the step's ✕ (or changed elsewhere): show the new limit.
  const [shownLimit, setShownLimit] = useState(spec.limit);
  if (shownLimit !== spec.limit) {
    setShownLimit(spec.limit);
    if (spec.limit === null ? draft.trim() !== '' : Number(draft) !== spec.limit) {
      setDraft(spec.limit === null ? '' : String(spec.limit));
    }
  }
  const groupedLimit = spec.breakouts.length > 1;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QUESTION_LIMIT}
          value={draft}
          placeholder={t`No limit`}
          aria-label={t`Maximum number of rows`}
          className="h-9 w-28"
          onChange={(event) => {
            setDraft(event.target.value);
            const value = Number(event.target.value);
            if (event.target.value === '') onChange(null);
            else if (Number.isFinite(value) && value >= 1) onChange(value);
          }}
        />
        {spec.limit === null &&
          LIMIT_PRESETS.map((preset) => (
            <Button
              key={preset}
              variant="ghost"
              size="sm"
              className="h-8 rounded-full border border-dashed px-3 text-muted-foreground"
              onClick={() => {
                setDraft(String(preset));
                onChange(preset);
              }}
            >
              {preset}
            </Button>
          ))}
        {spec.limit !== null && (
          <span className="text-sm text-muted-foreground">
            {groupedLimit
              ? plural(Number(draft) || 0, { one: 'value', other: 'values' })
              : plural(Number(draft) || 0, { one: 'row', other: 'rows' })}
          </span>
        )}
      </div>
      {groupedLimit && spec.limit !== null && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            With two groupings, the limit keeps the top values of the first non-date grouping.
          </Trans>
        </p>
      )}
    </div>
  );
}
