import { useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarRange } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import DateRangePicker from '@shared/ui/date-range-picker';
import { formatDateISO, formatShortDate, parseDateKey } from '@shared/lib/date-utils';
import type { AnalyticsData } from '../useAnalyticsData';
import { PERIOD_LABELS, type AnalyticsPageState, type PeriodKey } from '../analytics-state';
import { MultiSelectFilterControl } from './MultiSelectFilterControl';

interface AnalyticsFilterBarProps {
  state: AnalyticsPageState;
  data: AnalyticsData;
  /** Which dimension filters apply to the active report. */
  showCategoryFilters: boolean;
}

export function AnalyticsFilterBar({ state, data, showCategoryFilters }: AnalyticsFilterBarProps) {
  const { selections, update } = state;

  const accountGroups = useMemo(() => {
    const budget = data.accounts.filter((account) => account.onBudget);
    const tracking = data.accounts.filter((account) => !account.onBudget);
    return [
      { key: 'budget', heading: 'Budget accounts', items: budget },
      ...(tracking.length
        ? [{ key: 'tracking', heading: 'Tracking accounts', items: tracking }]
        : []),
    ];
  }, [data.accounts]);

  const categoryGroupsList = useMemo(
    () =>
      data.categoryGroups
        .map((group) => ({
          key: group.id,
          heading: group.name,
          items: data.categories.filter((category) => category.groupId === group.id),
        }))
        .filter((group) => group.items.length > 0),
    [data.categories, data.categoryGroups]
  );

  // MultiSelectFilterControl works with numeric ids; payees are strings, so
  // map through their index in the sorted payee list.
  const payeeItems = useMemo(
    () => data.payees.map((name, index) => ({ id: index, name })),
    [data.payees]
  );
  const selectedPayeeIds = useMemo(
    () => selections.payees.map((name) => data.payees.indexOf(name)).filter((index) => index >= 0),
    [selections.payees, data.payees]
  );

  const customRange: DateRange | undefined = useMemo(() => {
    const from = selections.customStart
      ? (parseDateKey(selections.customStart) ?? undefined)
      : undefined;
    const to = selections.customEnd ? (parseDateKey(selections.customEnd) ?? undefined) : undefined;
    return from || to ? { from, to } : undefined;
  }, [selections.customStart, selections.customEnd]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selections.period}
        onValueChange={(value) => update({ period: value as PeriodKey })}
      >
        <SelectTrigger className="h-9 w-[160px]" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
            <SelectItem key={key} value={key}>
              {PERIOD_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selections.period === 'custom' ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-2">
              <CalendarRange className="h-4 w-4" />
              {customRange?.from && customRange?.to
                ? `${formatShortDate(customRange.from)} – ${formatShortDate(customRange.to)}`
                : 'Pick range'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DateRangePicker
              value={customRange}
              onChange={(range) =>
                update({
                  customStart: range?.from ? formatDateISO(range.from) : '',
                  customEnd: range?.to ? formatDateISO(range.to) : '',
                })
              }
            />
          </PopoverContent>
        </Popover>
      ) : null}

      <MultiSelectFilterControl
        groups={accountGroups}
        selectedIds={selections.accountIds}
        onChange={(ids) => update({ accountIds: ids })}
        getId={(account) => account.id}
        getLabel={(account) => account.name}
        isLoading={data.isLoading}
        hasItems={data.accounts.length > 0}
        buttonLabel={
          selections.accountIds.length === 0
            ? 'All accounts'
            : `${selections.accountIds.length} account${selections.accountIds.length > 1 ? 's' : ''}`
        }
        triggerWidthClassName="w-[150px]"
        contentClassName="w-[240px]"
        listClassName="max-h-[280px]"
        searchPlaceholder="Search accounts…"
        emptyText="No accounts found."
        allOptionLabel="All accounts"
        allOptionValue="all-accounts"
      />

      {showCategoryFilters ? (
        <>
          <MultiSelectFilterControl
            groups={categoryGroupsList}
            selectedIds={selections.categoryIds}
            onChange={(ids) => update({ categoryIds: ids })}
            getId={(category) => category.id}
            getLabel={(category) => category.name}
            isLoading={data.isLoading}
            hasItems={data.categories.length > 0}
            buttonLabel={
              selections.categoryIds.length === 0
                ? 'All categories'
                : `${selections.categoryIds.length} categor${selections.categoryIds.length > 1 ? 'ies' : 'y'}`
            }
            triggerWidthClassName="w-[150px]"
            contentClassName="w-[260px]"
            listClassName="max-h-[280px]"
            searchPlaceholder="Search categories…"
            emptyText="No categories found."
            allOptionLabel="All categories"
            allOptionValue="all-categories"
          />
          <MultiSelectFilterControl
            groups={[{ key: 'payees', heading: 'Payees', items: payeeItems }]}
            selectedIds={selectedPayeeIds}
            onChange={(ids) => update({ payees: ids.map((index) => data.payees[index]) })}
            getId={(payee) => payee.id}
            getLabel={(payee) => payee.name}
            isLoading={data.isLoading}
            hasItems={payeeItems.length > 0}
            buttonLabel={
              selections.payees.length === 0
                ? 'All payees'
                : `${selections.payees.length} payee${selections.payees.length > 1 ? 's' : ''}`
            }
            triggerWidthClassName="w-[140px]"
            contentClassName="w-[240px]"
            listClassName="max-h-[280px]"
            searchPlaceholder="Search payees…"
            emptyText="No payees found."
            allOptionLabel="All payees"
            allOptionValue="all-payees"
          />
          <MultiSelectFilterControl
            groups={[{ key: 'labels', heading: 'Labels', items: data.labels }]}
            selectedIds={selections.labelIds}
            onChange={(ids) => update({ labelIds: ids })}
            getId={(label) => label.id}
            getLabel={(label) => label.name}
            isLoading={data.isLoading}
            hasItems={data.labels.length > 0}
            buttonLabel={
              selections.labelIds.length === 0
                ? 'All labels'
                : `${selections.labelIds.length} label${selections.labelIds.length > 1 ? 's' : ''}`
            }
            triggerWidthClassName="w-[130px]"
            contentClassName="w-[220px]"
            listClassName="max-h-[280px]"
            searchPlaceholder="Search labels…"
            emptyText="No labels found."
            allOptionLabel="All labels"
            allOptionValue="all-labels"
          />
        </>
      ) : null}
    </div>
  );
}
