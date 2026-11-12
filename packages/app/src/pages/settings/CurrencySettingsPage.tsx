import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { parseISO } from 'date-fns';
import { formatDate as format } from '@shared/lib/date-format';
import { toast } from 'sonner';
import { Calendar as CalendarIcon, Coins, Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Checkbox } from '@shared/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Switch } from '@shared/ui/switch';
import { getRuntime } from '@shared/runtime/global';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { CalculatorCellDecimal } from '@shared/ui/calculator-cell';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useCustomCurrencyRates,
  useAddCustomCurrencyRate,
  useUpdateCustomCurrencyRate,
  useDeleteCustomCurrencyRate,
} from '@entities/currency/api/useCustomCurrencyRates';
import type { CustomCurrencyRate } from '@entities/currency/lib/currency-utils';
import {
  EXCHANGE_RATE_PRECISION,
  formatExchangeRate,
} from '@entities/currency/lib/exchange-rate-format';

const RETENTION_OPTIONS = [30, 60, 90, 180, 365] as const;

/** Daily-rate cache retention + reconnect-resync settings (user_meta backed). */
function RateCacheSettingsCard() {
  const { t } = useLingui();

  const [retentionDays, setRetentionDays] = useState<number>(() => {
    try {
      return getRuntime()?.services()?.userMeta.getRateCacheRetentionDays() ?? 30;
    } catch {
      return 30;
    }
  });
  const [resyncOnReconnect, setResyncOnReconnect] = useState<boolean>(() => {
    try {
      return getRuntime()?.services()?.userMeta.getResyncRatesOnReconnect() ?? true;
    } catch {
      return true;
    }
  });
  const selectedBudget = useUiStore((state) => state.selectedBudget);

  const commitRetention = (days: number) => {
    setRetentionDays(days);
    const services = getRuntime()?.services();
    if (!services) return;
    services.userMeta.setRateCacheRetentionDays(days);
    if (selectedBudget) {
      const pruned = services.currency.pruneRateCache(selectedBudget.ID);
      if (pruned > 0) {
        toast.success(t`Rate cache pruned`, {
          description: plural(pruned, {
            one: `# cached rate older than ${days} days removed.`,
            other: `# cached rates older than ${days} days removed.`,
          }),
        });
      }
    }
  };

  const commitResync = (value: boolean) => {
    setResyncOnReconnect(value);
    getRuntime()?.services()?.userMeta.setResyncRatesOnReconnect(value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          <Trans>Rate cache & offline sync</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Exchange rates are fetched daily and cached inside your budget file.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              <Trans>Keep cached rates for</Trans>
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Older rates are pruned and refetched on demand. Longer retention means fewer
                refetches for historical edits, but a larger budget file — which can slow app load
                and sync.
              </Trans>
            </p>
          </div>
          <Select value={String(retentionDays)} onValueChange={(v) => commitRetention(Number(v))}>
            <SelectTrigger className="w-32" aria-label={t`Keep cached rates for`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  <Trans>{days} days</Trans>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              <Trans>Update offline rates when back online</Trans>
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Transactions converted with a manually entered rate while offline are re-converted
                with the official rate once you reconnect. Rates you pinned on a transaction are
                never touched.
              </Trans>
            </p>
          </div>
          <Switch
            checked={resyncOnReconnect}
            onCheckedChange={commitResync}
            aria-label={t`Update offline rates when back online`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface RateFormData {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  startDate: Date | null;
  endDate: Date | null;
  /** Add flow only: also store the explicit reverse pair (on by default). */
  alsoReverse: boolean;
}

const emptyForm: RateFormData = {
  fromCurrency: '',
  toCurrency: '',
  rate: '',
  startDate: new Date(),
  endDate: null,
  alsoReverse: true,
};

/** Format a Date to YYYY-MM-DD string for storage */
function toDateString(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString('en-CA'); // "2025-09-26"
}

/** Parse a YYYY-MM-DD string to Date (local midnight) */
function fromDateString(str: string): Date | null {
  if (!str) return null;
  const d = parseISO(str);
  return isNaN(d.getTime()) ? null : d;
}

function DateField({
  label,
  value,
  emptyLabel,
  onChange,
  clearLabel,
}: {
  label: ReactNode;
  value: Date | null;
  emptyLabel: string;
  onChange: (date: Date | null) => void;
  /** When set, shows a clear button below the calendar while a date is selected. */
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start text-left h-9 px-3 bg-background border-input hover:bg-accent hover:text-accent-foreground font-normal"
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate">{value ? format(value, 'PPP') : emptyLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div>
            <MonthYearCalendar
              selected={value || undefined}
              onSelect={(date) => {
                onChange(date || null);
                setOpen(false);
              }}
            />
            {clearLabel && value && (
              <div className="p-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  {clearLabel}
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RateFormDialog({
  open,
  onOpenChange,
  editing,
  formData,
  setFormData,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  formData: RateFormData;
  setFormData: Dispatch<SetStateAction<RateFormData>>;
  onSave: () => void;
  isSaving: boolean;
}) {
  const { t } = useLingui();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t`Edit Exchange Rate` : t`Add Exchange Rate`}</DialogTitle>
          <DialogDescription>
            {editing
              ? t`Update the rate and date range. Affected transactions will be recalculated.`
              : t`Set a custom exchange rate for a specific date range.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-1">
          {/* Currency pair section */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Currency Pair</Trans>
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">
                  <Trans>From</Trans>
                </Label>
                <CurrencySelector
                  value={formData.fromCurrency}
                  onValueChange={(v) => setFormData((f) => ({ ...f, fromCurrency: v }))}
                  disabled={editing}
                  kind="all"
                  compact
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">
                  <Trans>To</Trans>
                </Label>
                <CurrencySelector
                  value={formData.toCurrency}
                  onValueChange={(v) => setFormData((f) => ({ ...f, toCurrency: v }))}
                  disabled={editing}
                  kind="all"
                  compact
                />
              </div>
            </div>
          </fieldset>

          {/* Rate section */}
          <div className="space-y-1.5">
            <Label className="text-sm">
              <Trans>Exchange Rate</Trans>
            </Label>
            {/* Decimal-contract calculator cell: rates are dimensionless and
                need EXCHANGE_RATE_PRECISION decimals — the MilliUnits cell
                would round them to 3. */}
            <CalculatorCellDecimal
              value={Number.parseFloat(formData.rate) || 0}
              onCommit={(value) =>
                setFormData((f) => ({
                  ...f,
                  rate: value > 0 ? String(Number(value.toFixed(EXCHANGE_RATE_PRECISION))) : '',
                }))
              }
              commitPrecision={EXCHANGE_RATE_PRECISION}
              formatter={(value) => formatExchangeRate(value)}
              placeholder="e.g. 1.0845"
              inputAlign="right"
              zeroAsEmpty
              className="w-full"
              data-testid="rate-input"
            />
            {formData.fromCurrency && formData.toCurrency && formData.rate && (
              <p className="text-xs text-muted-foreground mt-1">
                1 {formData.fromCurrency} = {formData.rate} {formData.toCurrency}
                {editing &&
                  (() => {
                    const parsed = Number.parseFloat(formData.rate);
                    if (!Number.isFinite(parsed) || parsed <= 0) return null;
                    return (
                      <Trans>
                        {' · '}the reverse (1 {formData.toCurrency} ={' '}
                        {Number((1 / parsed).toFixed(EXCHANGE_RATE_PRECISION))}{' '}
                        {formData.fromCurrency}) is applied automatically
                      </Trans>
                    );
                  })()}
              </p>
            )}
            {!editing &&
              formData.fromCurrency &&
              formData.toCurrency &&
              (() => {
                const parsed = Number.parseFloat(formData.rate);
                const reverseValue =
                  Number.isFinite(parsed) && parsed > 0
                    ? Number((1 / parsed).toFixed(EXCHANGE_RATE_PRECISION))
                    : null;
                return (
                  <div className="mt-2 flex items-start gap-2">
                    <Checkbox
                      id="also-reverse-rate"
                      checked={formData.alsoReverse}
                      onCheckedChange={(checked) =>
                        setFormData((f) => ({ ...f, alsoReverse: checked === true }))
                      }
                    />
                    <div>
                      <Label htmlFor="also-reverse-rate" className="text-sm font-normal">
                        <Trans>
                          Also add the reverse rate
                          {reverseValue !== null
                            ? ` (1 ${formData.toCurrency} = ${reverseValue} ${formData.fromCurrency})`
                            : ''}
                        </Trans>
                      </Label>
                      {!formData.alsoReverse && (
                        <p className="text-xs text-muted-foreground">
                          <Trans>
                            Conversions still derive the reverse automatically; unchecking only
                            skips the visible second entry.
                          </Trans>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* Date range section */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Trans>Date Range</Trans>
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DateField
                label={t`Start Date`}
                value={formData.startDate}
                emptyLabel="Select date"
                onChange={(date) => setFormData((f) => ({ ...f, startDate: date }))}
              />
              <DateField
                label={
                  <Trans>
                    End Date{' '}
                    <span className="font-normal text-muted-foreground">
                      <Trans>(optional)</Trans>
                    </span>
                  </Trans>
                }
                value={formData.endDate}
                emptyLabel="Open-ended"
                onChange={(date) => setFormData((f) => ({ ...f, endDate: date }))}
                clearLabel="Clear (open-ended)"
              />
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? t`Saving...` : editing ? t`Update` : t`Add`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CurrencySettingsPage() {
  const { t } = useLingui();

  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const budgetId = selectedBudget?.ID || 0;

  const { data: rates = [], isLoading } = useCustomCurrencyRates(budgetId);
  const addMutation = useAddCustomCurrencyRate();
  const updateMutation = useUpdateCustomCurrencyRate();
  const deleteMutation = useDeleteCustomCurrencyRate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<CustomCurrencyRate | null>(null);
  const [formData, setFormData] = useState<RateFormData>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<CustomCurrencyRate | null>(null);

  const openAddDialog = () => {
    setEditingRate(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (rate: CustomCurrencyRate) => {
    setEditingRate(rate);
    setFormData({
      fromCurrency: rate.FromCurrency,
      toCurrency: rate.ToCurrency,
      rate: rate.Rate.toString(),
      startDate: fromDateString(rate.StartDate),
      endDate: rate.EndDate ? fromDateString(rate.EndDate) : null,
      alsoReverse: false,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const rateNum = parseFloat(formData.rate);
    if (!formData.fromCurrency || !formData.toCurrency || isNaN(rateNum) || rateNum <= 0) {
      toast.error(t`Invalid input`, {
        description: t`Please fill in all required fields with valid values.`,
      });
      return;
    }
    if (formData.fromCurrency === formData.toCurrency) {
      toast.error(t`Same currency`, { description: t`From and To currencies must be different.` });
      return;
    }
    if (!formData.startDate) {
      toast.error(t`Missing start date`, { description: t`Please specify a start date.` });
      return;
    }

    const startDateStr = toDateString(formData.startDate);
    const endDateStr = formData.endDate ? toDateString(formData.endDate) : null;

    try {
      if (editingRate) {
        const result = await updateMutation.mutateAsync({
          id: editingRate.ID,
          rate: rateNum,
          startDate: startDateStr,
          endDate: endDateStr,
          budgetId,
        });
        const count = result.recalculated;
        toast.success(t`Rate updated`, {
          description:
            count > 0
              ? plural(count, {
                  one: `# transaction recalculated.`,
                  other: `# transactions recalculated.`,
                })
              : t`No transactions were affected.`,
        });
      } else {
        const result = await addMutation.mutateAsync({
          fromCurrency: formData.fromCurrency,
          toCurrency: formData.toCurrency,
          rate: rateNum,
          startDate: startDateStr,
          endDate: endDateStr,
          budgetId,
          alsoReverse: formData.alsoReverse,
        });
        const count = result.recalculated;
        toast.success(t`Rate added`, {
          description:
            count > 0
              ? plural(count, {
                  one: `# transaction recalculated.`,
                  other: `# transactions recalculated.`,
                })
              : t`Rate saved. New transactions will use this rate.`,
        });
      }
      setDialogOpen(false);
    } catch (err) {
      console.error('Failed to save rate:', err);
      toast.error(t`Failed to save`, { description: t`An error occurred while saving the rate.` });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await deleteMutation.mutateAsync({
        id: deleteTarget.ID,
        budgetId,
      });
      const count = result.recalculated;
      toast.success(t`Rate deleted`, {
        description:
          count > 0
            ? plural(count, {
                one: `# transaction recalculated using fallback rates.`,
                other: `# transactions recalculated using fallback rates.`,
              })
            : t`No transactions were affected.`,
      });
    } catch (err) {
      console.error('Failed to delete rate:', err);
      toast.error(t`Failed to delete`, {
        description: t`An error occurred while deleting the rate.`,
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  const isSaving = addMutation.isPending || updateMutation.isPending;

  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title={t`Currencies`}
        description={t`Manage custom exchange rates for your budget. Custom rates take priority over automatically fetched rates for transactions and account balances within the specified date range.`}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Trans>
                  <Coins className="h-5 w-5" />
                  Custom Exchange Rates
                </Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Define exchange rates with date ranges. Transactions without a manual rate
                  override will be recalculated when you add, edit, or delete a custom rate.
                </Trans>
              </CardDescription>
            </div>
            <Button size="sm" onClick={openAddDialog}>
              <Trans>
                <Plus className="h-4 w-4 mr-1" />
                Add Rate
              </Trans>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              <Trans>Loading rates...</Trans>
            </p>
          ) : rates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Coins className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">
                <Trans>No custom rates defined</Trans>
              </p>
              <p className="text-xs mt-1">
                <Trans>
                  Add a custom rate to override automatically fetched exchange rates for specific
                  date ranges.
                </Trans>
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Trans>From</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans>To</Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans>Rate</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans>Start Date</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans>End Date</Trans>
                    </TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((rate) => (
                    <TableRow key={rate.ID}>
                      <TableCell className="font-medium">{rate.FromCurrency}</TableCell>
                      <TableCell className="font-medium">{rate.ToCurrency}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatExchangeRate(rate.Rate)}
                      </TableCell>
                      <TableCell>{rate.StartDate}</TableCell>
                      <TableCell>
                        {rate.EndDate || (
                          <span className="text-muted-foreground">
                            <Trans>No end date</Trans>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEditDialog(rate)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(rate)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RateCacheSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            <Trans>How it works</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              <Trans>
                <strong className="text-foreground">
                  <Trans>Custom rates take priority</Trans>
                </strong>
                over automatically fetched rates when a matching date range exists. Account balances
                are pinned to the custom rate too — no daily market revaluation while it's active.
              </Trans>
            </li>
            <li>
              <Trans>
                <strong className="text-foreground">
                  <Trans>Retroactive recalculation</Trans>
                </strong>
                — adding or changing a rate recalculates all affected transactions that don't have a
                manual override.
              </Trans>
            </li>
            <li>
              <Trans>
                <strong className="text-foreground">
                  <Trans>Manual overrides are protected</Trans>
                </strong>
                — transactions where you manually set the exchange rate in the table are never
                automatically changed.
              </Trans>
            </li>
            <li>
              <Trans>
                <strong className="text-foreground">
                  <Trans>Open-ended rates</Trans>
                </strong>
                — leave the end date empty to apply the rate to all future dates.
              </Trans>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Add/edit rate dialog */}
      <RateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={!!editingRate}
        formData={formData}
        setFormData={setFormData}
        onSave={handleSave}
        isSaving={isSaving}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t`Delete custom rate?`}
        description={
          <Trans>
            This will delete the {deleteTarget?.FromCurrency} → {deleteTarget?.ToCurrency} rate (
            {deleteTarget?.StartDate} – {deleteTarget?.EndDate || 'open'}). Affected transactions
            will be recalculated using fallback rates.
          </Trans>
        }
        confirmText={t`Delete`}
        loadingText="Deleting..."
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
