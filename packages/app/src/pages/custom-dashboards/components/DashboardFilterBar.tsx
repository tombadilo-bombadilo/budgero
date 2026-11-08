import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useState, type ReactNode } from 'react';
import { CalendarRange, Check, ChevronDown, X } from 'lucide-react';
import {
  DASHBOARD_DATE_PRESETS,
  hasDashboardFilters,
  isValidIsoDate,
  normalizeDashboardFilters,
  type DashboardDatePreset,
  type DashboardFilters,
} from '@features/reports/lib/question';
import { formatBucketValue } from '@features/reports/ui/notebook/question-labels';
import {
  useFieldValueOptions,
  type ValueOption,
} from '@features/reports/ui/notebook/useFieldValueOptions';
import { Button } from '@shared/ui/button';
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

interface DashboardFilterBarProps {
  budgetId: number;
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
}

const ALL_TIME = 'all';

/**
 * Filters for the whole dashboard: a date range plus accounts and category
 * groups. Each notebook-question widget applies the ones its data has.
 */
export function DashboardFilterBar({ budgetId, filters, onChange }: DashboardFilterBarProps) {
  const { t } = useLingui();
  const options = useFieldValueOptions(budgetId);
  const id = useId();
  const [customOpen, setCustomOpen] = useState(false);

  const presetLabel = (preset: DashboardDatePreset): string => {
    switch (preset) {
      case 'thisMonth':
        return t`This month`;
      case 'lastMonth':
        return t`Last month`;
      case 'last3Months':
        return t`Last 3 months`;
      case 'last6Months':
        return t`Last 6 months`;
      case 'last12Months':
        return t`Last 12 months`;
      case 'thisYear':
        return t`This year`;
      case 'lastYear':
        return t`Last year`;
      case 'custom':
        return t`Custom range…`;
    }
  };
  const update = (patch: Partial<DashboardFilters>) =>
    onChange(normalizeDashboardFilters({ ...filters, ...patch }));

  const { date } = filters;
  const customText =
    date?.preset === 'custom' && date.from && date.to
      ? `${formatBucketValue('day', date.from)} – ${formatBucketValue('day', date.to)}`
      : null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2"
      role="group"
      aria-label={t`Dashboard filters`}
    >
      <Label htmlFor={`${id}-date`} className="sr-only">
        <Trans>Date range</Trans>
      </Label>
      <CustomRangePopover
        open={customOpen}
        onOpenChange={setCustomOpen}
        initialFrom={date?.from}
        initialTo={date?.to}
        onApply={(from, to) => {
          update({ date: { preset: 'custom', from, to } });
          setCustomOpen(false);
        }}
      >
        <Select
          value={date?.preset ?? ALL_TIME}
          onValueChange={(value) => {
            if (value === 'custom') {
              setCustomOpen(true);
              return;
            }
            update({
              date: value === ALL_TIME ? undefined : { preset: value as DashboardDatePreset },
            });
          }}
        >
          <SelectTrigger id={`${id}-date`} className="h-8 w-auto min-w-40 gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
            <SelectValue>
              {customText ?? (date ? presetLabel(date.preset) : t`All time`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TIME}>{t`All time`}</SelectItem>
            {DASHBOARD_DATE_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {presetLabel(preset)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CustomRangePopover>

      <MultiSelectFilter
        label={t`Accounts`}
        allLabel={t`All accounts`}
        options={options('account')}
        selected={filters.accounts ?? []}
        onChange={(accounts) => update({ accounts })}
      />
      <MultiSelectFilter
        label={t`Category groups`}
        allLabel={t`All category groups`}
        options={options('categoryGroup')}
        selected={filters.categoryGroups ?? []}
        onChange={(categoryGroups) => update({ categoryGroups })}
      />

      {hasDashboardFilters(filters) && (
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onChange({})}>
          <X className="h-4 w-4" aria-hidden />
          <Trans>Clear filters</Trans>
        </Button>
      )}
    </div>
  );
}

function CustomRangePopover({
  open,
  onOpenChange,
  initialFrom,
  initialTo,
  onApply,
  children,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFrom?: string;
  initialTo?: string;
  onApply: (from: string, to: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div className="inline-flex">{children}</div>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-72 space-y-3 p-4">
        <CustomRangeForm
          initialFrom={initialFrom}
          initialTo={initialTo}
          onCancel={() => onOpenChange(false)}
          onApply={onApply}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted each time the popover opens, so it starts from the saved range. */
function CustomRangeForm({
  initialFrom,
  initialTo,
  onCancel,
  onApply,
}: {
  initialFrom?: string;
  initialTo?: string;
  onCancel: () => void;
  onApply: (from: string, to: string) => void;
}) {
  const id = useId();
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const valid = isValidIsoDate(from) && isValidIsoDate(to);
  return (
    <>
      <h3 className="text-sm font-medium">
        <Trans>Custom range</Trans>
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-from`} className="text-xs font-normal">
            <Trans>From</Trans>
          </Label>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-to`} className="text-xs font-normal">
            <Trans>To</Trans>
          </Label>
          <Input
            id={`${id}-to`}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-8"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button size="sm" disabled={!valid} onClick={() => onApply(from, to)}>
          <Trans>Apply</Trans>
        </Button>
      </div>
    </>
  );
}

function MultiSelectFilter({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: ValueOption[];
  selected: number[];
  onChange: (values: number[] | undefined) => void;
}) {
  const { t } = useLingui();
  const chosen = new Set(selected);
  const names = options
    .filter((option) => chosen.has(option.value as number))
    .map((option) => option.label);
  const count = names.length;
  const summary = count === 0 ? allLabel : count === 1 ? names[0] : t`${label}: ${count} selected`;
  const toggle = (value: number) => {
    const next = new Set(chosen);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next.size > 0 ? Array.from(next) : undefined);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={count > 0 ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 max-w-60 gap-1.5"
          aria-label={`${label}: ${summary}`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t`Search…`} />
          <CommandList>
            <CommandEmpty>
              <Trans>No matches.</Trans>
            </CommandEmpty>
            <CommandGroup heading={label}>
              {options.map((option) => {
                const value = option.value as number;
                const on = chosen.has(value);
                return (
                  <CommandItem
                    key={value}
                    value={`${option.label} ${value}`}
                    onSelect={() => toggle(value)}
                    aria-selected={on}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-sm border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'opacity-60'
                      )}
                      aria-hidden
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {count > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start text-xs"
              onClick={() => onChange(undefined)}
            >
              <Trans>Clear selection</Trans>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
