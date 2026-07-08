import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  fromDecimal,
  toDecimal,
  type MilliUnits,
  Account,
  Category,
  RecurringSchedule,
} from '@budgero/core/browser';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Input } from '@shared/ui/input';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { Textarea } from '@shared/ui/textarea';
import { Label } from '@shared/ui/label';
import { Field } from '@shared/ui/field';
import { Switch } from '@shared/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@shared/ui/sheet';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { usePlainNumberFormatter } from '@shared/hooks/useNumberFormatter';
import { useUiStore } from '@shared/store/useUiStore';
import { Calendar as CalendarIcon } from 'lucide-react';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';

type RecurringDirection = 'inflow' | 'outflow';

interface RecurringFormValues {
  name: string;
  memo: string;
  amount: string;
  direction: RecurringDirection;
  accountId: string;
  categoryId: string;
  frequency: string;
  startDate: string;
  notifyDaysBefore: string;
  active: boolean;
}

export interface RecurringTransactionEditorSubmit {
  name: string;
  memo: string;
  amount: MilliUnits;
  direction: RecurringDirection;
  accountId: number | null;
  categoryId: number | null;
  schedule: RecurringSchedule;
  notifyDaysBefore: number;
  active: boolean;
}

export interface RecurringTransactionEditorProps {
  open: boolean;
  mode: 'create' | 'edit';
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  categories: Category[];
  initialValues?: Partial<{
    name: string;
    memo: string;
    amount: MilliUnits;
    direction: RecurringDirection;
    accountId: number | null;
    categoryId: number | null;
    schedule: RecurringSchedule;
    notifyDaysBefore: number;
    active: boolean;
  }>;
  onSubmit: (values: RecurringTransactionEditorSubmit) => Promise<void> | void;
  isSubmitting?: boolean;
}

const FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: 'day:1', label: 'Daily' },
  { value: 'week:1', label: 'Weekly' },
  { value: 'week:2', label: 'Every 2 weeks' },
  { value: 'month:1', label: 'Monthly' },
  { value: 'month:2', label: 'Every 2 months' },
  { value: 'month:3', label: 'Quarterly' },
  { value: 'month:6', label: 'Every 6 months' },
  { value: 'year:1', label: 'Yearly' },
];

function scheduleToFrequency(schedule: RecurringSchedule): string {
  const key = `${schedule.intervalUnit}:${schedule.intervalCount ?? 1}`;
  return key;
}

function frequencyToSchedule(value: string, startDate: string): RecurringSchedule {
  const [unit, countRaw] = value.split(':');
  const intervalCount = Math.max(1, Number(countRaw || '1'));
  return {
    startDate,
    intervalUnit: (unit as RecurringSchedule['intervalUnit']) ?? 'month',
    intervalCount,
  };
}

function addCustomFrequencyOption(value: string): { value: string; label: string }[] {
  if (FREQUENCY_OPTIONS.some((option) => option.value === value)) {
    return FREQUENCY_OPTIONS;
  }
  const [unit, countRaw] = value.split(':');
  const count = Math.max(1, Number(countRaw || '1'));
  const unitLabel =
    unit === 'day'
      ? count === 1
        ? 'day'
        : 'days'
      : unit === 'week'
        ? count === 1
          ? 'week'
          : 'weeks'
        : unit === 'month'
          ? count === 1
            ? 'month'
            : 'months'
          : count === 1
            ? 'year'
            : 'years';
  const label = count === 1 ? `Every ${unitLabel}` : `Every ${count} ${unitLabel}`;
  return [...FREQUENCY_OPTIONS, { value, label }];
}

function defaultFormValues(): RecurringFormValues {
  const today = format(new Date(), 'yyyy-MM-dd');
  return {
    name: '',
    memo: '',
    amount: '',
    direction: 'outflow',
    accountId: '',
    categoryId: '',
    frequency: 'month:1',
    startDate: today,
    notifyDaysBefore: '0',
    active: true,
  };
}

export function RecurringTransactionEditor({
  open,
  mode,
  onOpenChange,
  accounts,
  categories,
  initialValues,
  onSubmit,
  isSubmitting = false,
}: RecurringTransactionEditorProps) {
  const isMobile = useIsMobile();
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const plainNumberFormatter = usePlainNumberFormatter(globalLocalizer);
  const [formValues, setFormValues] = useState<RecurringFormValues>(defaultFormValues);
  const [startDateOpen, setStartDateOpen] = useState(false);

  // Initialize form when dialog opens - defer to avoid synchronous cascade
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const base = defaultFormValues();
      const schedule = initialValues?.schedule;
      setFormValues({
        name: initialValues?.name ?? base.name,
        memo: initialValues?.memo ?? base.memo,
        amount:
          typeof initialValues?.amount === 'number'
            ? String(Math.abs(toDecimal(initialValues.amount)))
            : base.amount,
        direction: initialValues?.direction ?? base.direction,
        accountId:
          initialValues?.accountId !== undefined && initialValues.accountId !== null
            ? String(initialValues.accountId)
            : base.accountId,
        categoryId:
          initialValues?.categoryId !== undefined && initialValues.categoryId !== null
            ? String(initialValues.categoryId)
            : base.categoryId,
        frequency: schedule ? scheduleToFrequency(schedule) : base.frequency,
        startDate: schedule?.startDate ?? base.startDate,
        notifyDaysBefore:
          initialValues?.notifyDaysBefore !== undefined
            ? String(initialValues.notifyDaysBefore)
            : base.notifyDaysBefore,
        active: initialValues?.active !== undefined ? Boolean(initialValues.active) : base.active,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open, initialValues]);

  // Close date picker when dialog closes - defer to avoid synchronous cascade
  useEffect(() => {
    if (!open) {
      const id = requestAnimationFrame(() => setStartDateOpen(false));
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const frequencyOptions = useMemo(
    () => addCustomFrequencyOption(formValues.frequency),
    [formValues.frequency]
  );

  const minSelectableDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, []);

  const selectedStartDate = useMemo(() => {
    if (!formValues.startDate) return null;
    const [year, month, day] = formValues.startDate.split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date;
  }, [formValues.startDate]);

  const calendarDefaultMonth = useMemo(() => {
    if (selectedStartDate && selectedStartDate >= minSelectableDate) {
      return selectedStartDate;
    }
    return minSelectableDate;
  }, [selectedStartDate, minSelectableDate]);

  const startDateLabel = selectedStartDate ? format(selectedStartDate, 'PPP') : 'Pick a date';

  const handleStartDateSelect = (date?: Date) => {
    if (!date) return;
    const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    normalized.setHours(0, 0, 0, 0);
    const next = normalized < minSelectableDate ? new Date(minSelectableDate) : normalized;
    setFormValues((prev) => ({ ...prev, startDate: format(next, 'yyyy-MM-dd') }));
    setStartDateOpen(false);
  };

  const handleSubmit = async () => {
    const amount = Number(formValues.amount);
    const accountId = formValues.accountId ? Number(formValues.accountId) : null;
    const categoryId = formValues.categoryId ? Number(formValues.categoryId) : null;
    const notifyDaysBefore = Math.max(0, Number(formValues.notifyDaysBefore || '0'));

    await onSubmit({
      name: formValues.name.trim(),
      memo: formValues.memo.trim(),
      amount: fromDecimal(Math.abs(amount) || 0),
      direction: formValues.direction,
      accountId,
      categoryId,
      schedule: frequencyToSchedule(formValues.frequency, formValues.startDate),
      notifyDaysBefore,
      active: formValues.active,
    });
  };

  const content = (
    <div className="flex-1 overflow-y-auto px-6 py-4" data-testid="recurring-transaction-form">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="rt-name" className="space-y-2">
            <Input
              id="rt-name"
              value={formValues.name}
              onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="e.g. Paycheck"
              data-testid="recurring-name-input"
            />
          </Field>
          <Field label="Amount" htmlFor="rt-amount" className="space-y-2">
            <CalculatorCell
              value={fromDecimal(formValues.amount ? Number(formValues.amount) : 0)}
              onCommit={(val) =>
                setFormValues((prev) => ({ ...prev, amount: String(toDecimal(val)) }))
              }
              formatter={(val) => plainNumberFormatter.format(val)}
              localizer={plainNumberFormatter}
              zeroAsEmpty
              placeholder="0.00"
              inputAlign="left"
              data-testid="recurring-amount-input"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" className="space-y-2">
            <Select
              value={formValues.direction}
              onValueChange={(value: RecurringDirection) =>
                setFormValues((prev) => ({ ...prev, direction: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inflow">Income / deposit</SelectItem>
                <SelectItem value="outflow">Bill / payment</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Account" className="space-y-2">
            <Select
              value={formValues.accountId}
              onValueChange={(value) => setFormValues((prev) => ({ ...prev, accountId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.ID} value={String(account.ID)}>
                    {account.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Category" className="space-y-2">
          <Select
            value={formValues.categoryId}
            onValueChange={(value) => setFormValues((prev) => ({ ...prev, categoryId: value }))}
          >
            <SelectTrigger data-testid="recurring-category-select">
              <SelectValue placeholder="Choose category" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {categories.map((category) => (
                <SelectItem key={category.ID} value={String(category.ID)}>
                  {category.Name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cadence" className="space-y-2">
            <Select
              value={formValues.frequency}
              onValueChange={(value) => setFormValues((prev) => ({ ...prev, frequency: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select cadence" />
              </SelectTrigger>
              <SelectContent>
                {frequencyOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="First occurrence" htmlFor="rt-start" className="space-y-2">
            <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  id="rt-start"
                  type="button"
                  className="w-full justify-start gap-2 text-left font-normal"
                >
                  <CalendarIcon className="h-4 w-4 opacity-70" />
                  {startDateLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start" modal>
                <MonthYearCalendar
                  selected={selectedStartDate ?? undefined}
                  onSelect={handleStartDateSelect}
                  defaultMonth={calendarDefaultMonth}
                  disabled={{ before: minSelectableDate }}
                />
              </PopoverContent>
            </Popover>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Notify me"
            htmlFor="rt-notify"
            className="space-y-2"
            hint="Days before due date (0 for same-day reminder)."
          >
            <Input
              id="rt-notify"
              type="number"
              min="0"
              value={formValues.notifyDaysBefore}
              onChange={(event) =>
                setFormValues((prev) => ({ ...prev, notifyDaysBefore: event.target.value }))
              }
              placeholder="0"
            />
          </Field>
          <div className="space-y-2">
            <Label htmlFor="rt-active">Status</Label>
            <div className="flex items-center gap-2 rounded-md border border-input px-3 py-2">
              <Switch
                id="rt-active"
                checked={formValues.active}
                onCheckedChange={(checked) =>
                  setFormValues((prev) => ({ ...prev, active: checked }))
                }
              />
              <span className="text-sm text-muted-foreground">
                {formValues.active ? 'Active – keep reminding me' : 'Paused'}
              </span>
            </div>
          </div>
        </div>

        <Field label="Memo (optional)" htmlFor="rt-memo" className="space-y-2">
          <Textarea
            id="rt-memo"
            rows={3}
            value={formValues.memo}
            onChange={(event) => setFormValues((prev) => ({ ...prev, memo: event.target.value }))}
            placeholder="This note will be copied into the transaction memo."
          />
        </Field>
      </div>
    </div>
  );

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        Cancel
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full sm:w-auto"
        data-testid="recurring-submit"
      >
        {isSubmitting
          ? 'Saving...'
          : mode === 'create'
            ? 'Create recurring transaction'
            : 'Save changes'}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex h-[min(92vh,700px)] w-full max-w-full flex-col overflow-hidden rounded-t-3xl border-0 bg-background p-0 sm:max-w-2xl"
        >
          <SheetHeader className="space-y-1 border-b px-6 py-5">
            <SheetTitle>
              {mode === 'create' ? 'New recurring transaction' : 'Edit recurring transaction'}
            </SheetTitle>
            <SheetDescription>
              Describe how often this happens and which account & category it should use. Budgero
              will remind you at the right time.
            </SheetDescription>
          </SheetHeader>
          {content}
          <SheetFooter className="border-t bg-background/95 px-6 py-4">{footer}</SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New recurring transaction' : 'Edit recurring transaction'}
          </DialogTitle>
          <DialogDescription>
            Describe how often this happens and which account & category it should use. Budgero will
            remind you at the right time.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-1 sm:px-0">{content}</div>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
