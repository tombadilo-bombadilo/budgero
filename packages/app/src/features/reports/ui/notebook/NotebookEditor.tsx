import { Trans, useLingui } from '@lingui/react/macro';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Database,
  Filter,
  ListOrdered,
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
  MAX_QUESTION_LIMIT,
  NUMERIC_AGGREGATIONS,
  QUESTION_SOURCES,
  SOURCE_FIELDS,
  createQuestion,
  getField,
  groupableFields,
  normalizeQuestion,
  numericFields,
  questionColumns,
  type DateBucket,
  type QuestionAggregation,
  type QuestionBreakout,
  type QuestionFilter,
  type QuestionSource,
  type QuestionSpec,
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
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { cn } from '@shared/lib/utils';
import { FieldList, FilterEditor } from './FilterEditor';
import {
  aggregationHint,
  aggregationLabel,
  bucketLabel,
  booleanLabel,
  columnLabel,
  fieldLabel,
  filterSummary,
  sourceDescription,
  sourceLabel,
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
    <div className="space-y-3">
      <ol className="space-y-3" aria-label={t`Question steps`}>
        <NotebookStep title={t`Data`} icon={Database} tone="data">
          <DataStep
            spec={spec}
            onSourceChange={(source) => {
              setOpened(new Set());
              onChange(createQuestion(source));
            }}
            onColumnsChange={(columns) => update({ columns })}
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
        'rounded-lg border border-l-4 bg-card p-3 text-card-foreground shadow-xs',
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
}: {
  spec: QuestionSpec;
  onSourceChange: (source: QuestionSource) => void;
  onColumnsChange: (columns: string[] | null) => void;
}) {
  const { t } = useLingui();
  const raw = spec.aggregations.length === 0;
  const columns = spec.columns ?? [...DEFAULT_RAW_COLUMNS[spec.source]];
  const columnCount = columns.length;
  const toggleColumn = (fieldId: string, checked: boolean) => {
    const next = checked
      ? SOURCE_FIELDS[spec.source]
          .map((field) => field.id)
          .filter((id) => id === fieldId || columns.includes(id))
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
                {SOURCE_FIELDS[spec.source].map((field) => {
                  const id = `column-${field.id}`;
                  const checked = columns.includes(field.id);
                  return (
                    <div key={field.id} className="flex items-center gap-2 rounded px-1 py-1">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={checked && columns.length === 1}
                        onCheckedChange={(value) => toggleColumn(field.id, value === true)}
                      />
                      <Label htmlFor={id} className="font-normal">
                        {fieldLabel(spec.source, field.id)}
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
    return filterSummary(spec.source, filter, (value) =>
      typeof value === 'boolean' ? booleanLabel(value) : (names.get(String(value)) ?? String(value))
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
              <span>
                <Chip
                  label={label}
                  editLabel={t`Edit filter: ${label}`}
                  onEdit={() => setEditing(index)}
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
  source,
  onPick,
}: {
  source: QuestionSource;
  onPick: (aggregation: QuestionAggregation) => void;
}) {
  const { t } = useLingui();
  const numbers = numericFields(source);
  const distinctFields = SOURCE_FIELDS[source].filter((field) => field.type !== 'number');
  const item = (aggregation: QuestionAggregation, hint?: string | null) => {
    const label = aggregationLabel(source, aggregation);
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
            numbers.map((field) => item({ op, field: field.id }))
          )}
        </CommandGroup>
        <CommandGroup heading={t`Distinct values`}>
          {distinctFields.map((field) => item({ op: 'distinct', field: field.id }))}
        </CommandGroup>
      </CommandList>
    </Command>
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
  const [groupOpen, setGroupOpen] = useState(false);
  const groupable = groupableFields(spec.source);

  const pickMetric = (aggregation: QuestionAggregation) => {
    if (metricOpen === null) return;
    onChange({
      aggregations:
        metricOpen === -1
          ? [...spec.aggregations, aggregation]
          : spec.aggregations.map((item, index) => (index === metricOpen ? aggregation : item)),
    });
    setMetricOpen(null);
  };

  const pickGroup = (fieldId: string) => {
    const field = getField(spec.source, fieldId);
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

  const metricPopover = (
    <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0">
      <MetricPicker source={spec.source} onPick={pickMetric} />
    </PopoverContent>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Metrics`}>
        {spec.aggregations.map((aggregation, index) => {
          const label = aggregationLabel(spec.source, aggregation);
          return (
            <Popover
              key={index}
              open={metricOpen === index}
              onOpenChange={(isOpen) => setMetricOpen(isOpen ? index : null)}
            >
              <PopoverAnchor asChild>
                <span>
                  <Chip
                    label={label}
                    editLabel={t`Change metric: ${label}`}
                    onEdit={() => setMetricOpen(index)}
                    onRemove={() => {
                      setMetricOpen(null);
                      onChange({ aggregations: spec.aggregations.filter((_, i) => i !== index) });
                    }}
                    removeLabel={t`Remove metric: ${label}`}
                  />
                </span>
              </PopoverAnchor>
              {metricPopover}
            </Popover>
          );
        })}
        {spec.aggregations.length < MAX_AGGREGATIONS && (
          <Popover
            open={metricOpen === -1}
            onOpenChange={(isOpen) => setMetricOpen(isOpen ? -1 : null)}
          >
            <PopoverTrigger asChild>
              <AddButton
                label={spec.aggregations.length === 0 ? t`Pick a metric` : t`Add metric`}
              />
            </PopoverTrigger>
            {metricPopover}
          </Popover>
        )}
      </div>

      <span className="self-center text-sm text-muted-foreground">
        <Trans>by</Trans>
      </span>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Groupings`}>
        {spec.breakouts.map((breakout, index) => {
          const field = getField(spec.source, breakout.field);
          const label = fieldLabel(spec.source, breakout.field);
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
