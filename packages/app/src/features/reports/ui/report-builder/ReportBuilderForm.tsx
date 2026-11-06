import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useState } from 'react';
import {
  AreaChart,
  BarChart3,
  ChevronDown,
  Hash,
  LineChart,
  PieChart,
  Table as TableIcon,
  type LucideIcon,
} from 'lucide-react';
import { Label } from '@shared/ui/label';
import { Input } from '@shared/ui/input';
import { Switch } from '@shared/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { DatePickerButton } from '@shared/ui/DatePickerButton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { cn } from '@shared/lib/utils';
import {
  BUILDER_CHART_TYPES,
  BUILDER_DATE_PRESETS,
  BUILDER_DIMENSIONS,
  BUILDER_MEASURES,
  BUILDER_SORTS,
  DEFAULT_CATEGORICAL_LIMIT,
  isTimeDimension,
  normalizeSpec,
  type BuilderChartType,
  type BuilderDatePreset,
  type BuilderDimension,
  type BuilderMeasure,
  type BuilderSort,
  type ReportBuilderFilters,
  type ReportBuilderSpec,
} from '../../lib/report-builder';
import { BuilderMultiSelect } from './BuilderMultiSelect';
import type { BuilderFilterOptions } from './useBuilderFilterOptions';
import {
  chartTypeLabel,
  datePresetLabel,
  dimensionLabel,
  measureLabel,
  sortLabel,
} from './builder-labels';

const CHART_ICONS: Record<BuilderChartType, LucideIcon> = {
  bar: BarChart3,
  line: LineChart,
  area: AreaChart,
  pie: PieChart,
  table: TableIcon,
  stat: Hash,
};

const NONE = '__none__';

interface ReportBuilderFormProps {
  spec: ReportBuilderSpec;
  onChange: (spec: ReportBuilderSpec) => void;
  options: BuilderFilterOptions;
}

/** Controlled form for a {@link ReportBuilderSpec}; every change emits a normalized spec. */
export function ReportBuilderForm({ spec, onChange, options }: ReportBuilderFormProps) {
  const { t } = useLingui();
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;

  const update = (patch: Partial<ReportBuilderSpec>) =>
    onChange(normalizeSpec({ ...spec, ...patch }));
  const updateFilters = (patch: Partial<ReportBuilderFilters>) =>
    update({ filters: { ...spec.filters, ...patch } });

  // Filters start collapsed on small screens so the chart stays in view.
  const [filtersOpen, setFiltersOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia?.('(max-width: 1023px)').matches
  );
  const activeFilters =
    Object.values(spec.filters).filter((values) => values.length > 0).length +
    (spec.includeTransfers ? 1 : 0) +
    (spec.includeOffBudget ? 1 : 0);

  const isStat = spec.chartType === 'stat';
  const isFlow = spec.measure === 'incomeVsSpending';
  const timeAxis = isTimeDimension(spec.groupBy);
  const splitDisabled = isStat || isFlow || spec.chartType === 'pie';

  const handleGroupBy = (groupBy: BuilderDimension) => {
    const wasTime = isTimeDimension(spec.groupBy);
    const nowTime = isTimeDimension(groupBy);
    const patch: Partial<ReportBuilderSpec> = { groupBy };
    if (wasTime && !nowTime) {
      patch.sort = 'valueDesc';
      patch.limit = DEFAULT_CATEGORICAL_LIMIT;
    }
    // A pie over time reads poorly; switch to a bar chart.
    if (nowTime && spec.chartType === 'pie') patch.chartType = 'bar';
    update(patch);
  };

  const handleLimit = (raw: string) => {
    const trimmed = raw.trim();
    update({ limit: trimmed === '' ? null : Number(trimmed) });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby={fieldId('what')}>
        <h2 id={fieldId('what')} className="text-sm font-semibold">
          <Trans>What to show</Trans>
        </h2>

        <div className="space-y-1.5">
          <Label htmlFor={fieldId('measure')}>
            <Trans>Measure</Trans>
          </Label>
          <Select
            value={spec.measure}
            onValueChange={(value) => update({ measure: value as BuilderMeasure })}
          >
            <SelectTrigger id={fieldId('measure')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUILDER_MEASURES.map((measure) => (
                <SelectItem key={measure} value={measure}>
                  {measureLabel(measure)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <span id={fieldId('chart-label')} className="text-sm font-medium leading-none">
            <Trans>Chart</Trans>
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={spec.chartType}
            onValueChange={(value) => {
              if (value) update({ chartType: value as BuilderChartType });
            }}
            aria-labelledby={fieldId('chart-label')}
            className="flex w-full flex-wrap"
          >
            {BUILDER_CHART_TYPES.map((chartType) => {
              const Icon = CHART_ICONS[chartType];
              const disabled =
                (isFlow && (chartType === 'pie' || chartType === 'stat')) ||
                (timeAxis && chartType === 'pie');
              return (
                <ToggleGroupItem
                  key={chartType}
                  value={chartType}
                  aria-label={chartTypeLabel(chartType)}
                  title={chartTypeLabel(chartType)}
                  disabled={disabled}
                  className="flex-1"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={fieldId('group')}>
              <Trans>Group by</Trans>
            </Label>
            <Select
              value={spec.groupBy}
              onValueChange={(value) => handleGroupBy(value as BuilderDimension)}
              disabled={isStat}
            >
              <SelectTrigger id={fieldId('group')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUILDER_DIMENSIONS.map((dimension) => (
                  <SelectItem key={dimension} value={dimension}>
                    {dimensionLabel(dimension)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={fieldId('split')}>
              <Trans>Split by</Trans>
            </Label>
            <Select
              value={spec.splitBy ?? NONE}
              onValueChange={(value) =>
                update({ splitBy: value === NONE ? null : (value as BuilderDimension) })
              }
              disabled={splitDisabled}
            >
              <SelectTrigger id={fieldId('split')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t`None`}</SelectItem>
                {BUILDER_DIMENSIONS.filter((dimension) => dimension !== spec.groupBy).map(
                  (dimension) => (
                    <SelectItem key={dimension} value={dimension}>
                      {dimensionLabel(dimension)}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!isStat && !timeAxis && (
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={fieldId('sort')}>
                <Trans>Sort</Trans>
              </Label>
              <Select
                value={spec.sort}
                onValueChange={(value) => update({ sort: value as BuilderSort })}
              >
                <SelectTrigger id={fieldId('sort')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUILDER_SORTS.map((sort) => (
                    <SelectItem key={sort} value={sort}>
                      {sortLabel(sort)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId('limit')}>
                <Trans>Show top</Trans>
              </Label>
              <Input
                id={fieldId('limit')}
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                placeholder={t`All`}
                value={spec.limit ?? ''}
                onChange={(event) => handleLimit(event.target.value)}
                className="h-9"
              />
            </div>
          </div>
        )}
      </section>

      <div className="space-y-1.5">
        <Label htmlFor={fieldId('dates')}>
          <Trans>Date range</Trans>
        </Label>
        <Select
          value={spec.dateRange.preset}
          onValueChange={(value) => update({ dateRange: { preset: value as BuilderDatePreset } })}
        >
          <SelectTrigger id={fieldId('dates')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BUILDER_DATE_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {datePresetLabel(preset)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {spec.dateRange.preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1" role="group" aria-label={t`From`}>
              <span className="text-xs text-muted-foreground">
                <Trans>From</Trans>
              </span>
              <DatePickerButton
                value={spec.dateRange.from ?? ''}
                placeholder={t`Any date`}
                onChange={(from) =>
                  update({ dateRange: { ...spec.dateRange, from: from || undefined } })
                }
              />
            </div>
            <div className="space-y-1" role="group" aria-label={t`To`}>
              <span className="text-xs text-muted-foreground">
                <Trans>To</Trans>
              </span>
              <DatePickerButton
                value={spec.dateRange.to ?? ''}
                placeholder={t`Any date`}
                onChange={(to) => update({ dateRange: { ...spec.dateRange, to: to || undefined } })}
              />
            </div>
          </div>
        )}
      </div>

      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} asChild>
        <section className="space-y-3" aria-labelledby={fieldId('filters')}>
          <h2 id={fieldId('filters')} className="text-sm font-semibold">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span>
                <Trans>Filters</Trans>
                {activeFilters > 0 && (
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                    <Trans>{activeFilters} active</Trans>
                  </span>
                )}
              </span>
              <ChevronDown
                aria-hidden
                className={cn('h-4 w-4 transition-transform', filtersOpen && 'rotate-180')}
              />
            </CollapsibleTrigger>
          </h2>
          <CollapsibleContent className="space-y-3">
            <FilterField id={fieldId('accounts')} label={t`Accounts`}>
              <BuilderMultiSelect
                id={fieldId('accounts')}
                label={t`Accounts`}
                options={options.accounts}
                selected={spec.filters.accountIds}
                onChange={(accountIds) => updateFilters({ accountIds })}
              />
            </FilterField>
            <FilterField id={fieldId('groups')} label={t`Category groups`}>
              <BuilderMultiSelect
                id={fieldId('groups')}
                label={t`Category groups`}
                options={options.categoryGroups}
                selected={spec.filters.categoryGroupIds}
                onChange={(categoryGroupIds) => updateFilters({ categoryGroupIds })}
              />
            </FilterField>
            <FilterField id={fieldId('categories')} label={t`Categories`}>
              <BuilderMultiSelect
                id={fieldId('categories')}
                label={t`Categories`}
                options={options.categories}
                selected={spec.filters.categoryIds}
                onChange={(categoryIds) => updateFilters({ categoryIds })}
              />
            </FilterField>
            <FilterField id={fieldId('payees')} label={t`Payees`}>
              <BuilderMultiSelect
                id={fieldId('payees')}
                label={t`Payees`}
                options={options.payees}
                selected={spec.filters.payees}
                onChange={(payees) => updateFilters({ payees })}
              />
            </FilterField>
            <FilterField id={fieldId('labels')} label={t`Labels`}>
              <BuilderMultiSelect
                id={fieldId('labels')}
                label={t`Labels`}
                options={options.labels}
                selected={spec.filters.labelIds}
                onChange={(labelIds) => updateFilters({ labelIds })}
              />
            </FilterField>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={fieldId('transfers')} className="font-normal">
                  <Trans>Include transfers</Trans>
                </Label>
                <Switch
                  id={fieldId('transfers')}
                  checked={spec.includeTransfers}
                  onCheckedChange={(includeTransfers) => update({ includeTransfers })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={fieldId('offbudget')} className="font-normal">
                  <Trans>Include off-budget accounts</Trans>
                </Label>
                <Switch
                  id={fieldId('offbudget')}
                  checked={spec.includeOffBudget}
                  onCheckedChange={(includeOffBudget) => update({ includeOffBudget })}
                />
              </div>
            </div>
          </CollapsibleContent>
        </section>
      </Collapsible>
    </div>
  );
}

function FilterField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
