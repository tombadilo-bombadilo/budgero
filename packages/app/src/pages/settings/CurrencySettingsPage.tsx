import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Calendar as CalendarIcon, Coins, Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
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
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
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

interface RateFormData {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  startDate: Date | null;
  endDate: Date | null;
}

const emptyForm: RateFormData = {
  fromCurrency: '',
  toCurrency: '',
  rate: '',
  startDate: new Date(),
  endDate: null,
};

/** Format a Date to YYYY-MM-DD string for storage */
function toDateString(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString('en-CA'); // "2025-09-26"
}

/** Parse a YYYY-MM-DD string to Date */
function fromDateString(str: string): Date | null {
  if (!str) return null;
  const d = new Date(`${str}T00:00:00`);
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Exchange Rate' : 'Add Exchange Rate'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the rate and date range. Affected transactions will be recalculated.'
              : 'Set a custom exchange rate for a specific date range.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-1">
          {/* Currency pair section */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Currency Pair
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">From</Label>
                <CurrencySelector
                  value={formData.fromCurrency}
                  onValueChange={(v) => setFormData((f) => ({ ...f, fromCurrency: v }))}
                  disabled={editing}
                  compact
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">To</Label>
                <CurrencySelector
                  value={formData.toCurrency}
                  onValueChange={(v) => setFormData((f) => ({ ...f, toCurrency: v }))}
                  disabled={editing}
                  compact
                />
              </div>
            </div>
          </fieldset>

          {/* Rate section */}
          <div className="space-y-1.5">
            <Label className="text-sm">Exchange Rate</Label>
            {/* Plain decimal input: exchange rates are dimensionless (up to
                EXCHANGE_RATE_PRECISION decimals), while CalculatorCell speaks
                integer MilliUnits and would round rates to 3 decimals. */}
            <Input
              value={formData.rate}
              onChange={(e) => setFormData((f) => ({ ...f, rate: e.target.value }))}
              onBlur={() => {
                const parsed = Number.parseFloat(formData.rate);
                if (Number.isFinite(parsed)) {
                  setFormData((f) => ({
                    ...f,
                    rate: String(Number(parsed.toFixed(EXCHANGE_RATE_PRECISION))),
                  }));
                }
              }}
              placeholder="e.g. 1.0845"
              inputMode="decimal"
              className="h-9 text-right"
              data-testid="rate-input"
            />
            {formData.fromCurrency && formData.toCurrency && formData.rate && (
              <p className="text-xs text-muted-foreground mt-1">
                1 {formData.fromCurrency} = {formData.rate} {formData.toCurrency}
              </p>
            )}
          </div>

          {/* Date range section */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Date Range
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DateField
                label="Start Date"
                value={formData.startDate}
                emptyLabel="Select date"
                onChange={(date) => setFormData((f) => ({ ...f, startDate: date }))}
              />
              <DateField
                label={
                  <>
                    End Date <span className="font-normal text-muted-foreground">(optional)</span>
                  </>
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
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : editing ? 'Update' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CurrencySettingsPage() {
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
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const rateNum = parseFloat(formData.rate);
    if (!formData.fromCurrency || !formData.toCurrency || isNaN(rateNum) || rateNum <= 0) {
      toast.error('Invalid input', {
        description: 'Please fill in all required fields with valid values.',
      });
      return;
    }
    if (formData.fromCurrency === formData.toCurrency) {
      toast.error('Same currency', { description: 'From and To currencies must be different.' });
      return;
    }
    if (!formData.startDate) {
      toast.error('Missing start date', { description: 'Please specify a start date.' });
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
        const count = (result as { recalculatedCount?: number })?.recalculatedCount ?? 0;
        toast.success('Rate updated', {
          description:
            count > 0
              ? `${count} transaction${count !== 1 ? 's' : ''} recalculated.`
              : 'No transactions were affected.',
        });
      } else {
        const result = await addMutation.mutateAsync({
          fromCurrency: formData.fromCurrency,
          toCurrency: formData.toCurrency,
          rate: rateNum,
          startDate: startDateStr,
          endDate: endDateStr,
          budgetId,
        });
        const count = (result as { recalculatedCount?: number })?.recalculatedCount ?? 0;
        toast.success('Rate added', {
          description:
            count > 0
              ? `${count} transaction${count !== 1 ? 's' : ''} recalculated.`
              : 'Rate saved. New transactions will use this rate.',
        });
      }
      setDialogOpen(false);
    } catch (err) {
      console.error('Failed to save rate:', err);
      toast.error('Failed to save', { description: 'An error occurred while saving the rate.' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await deleteMutation.mutateAsync({
        id: deleteTarget.ID,
        budgetId,
      });
      const count = (result as { recalculatedCount?: number })?.recalculatedCount ?? 0;
      toast.success('Rate deleted', {
        description:
          count > 0
            ? `${count} transaction${count !== 1 ? 's' : ''} recalculated using fallback rates.`
            : 'No transactions were affected.',
      });
    } catch (err) {
      console.error('Failed to delete rate:', err);
      toast.error('Failed to delete', {
        description: 'An error occurred while deleting the rate.',
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  const isSaving = addMutation.isPending || updateMutation.isPending;

  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title="Currencies"
        description="Manage custom exchange rates for your budget. Custom rates take priority over automatically fetched rates for transactions within the specified date range."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Custom Exchange Rates
              </CardTitle>
              <CardDescription>
                Define exchange rates with date ranges. Transactions without a manual rate override
                will be recalculated when you add, edit, or delete a custom rate.
              </CardDescription>
            </div>
            <Button size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-1" />
              Add Rate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading rates...</p>
          ) : rates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Coins className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No custom rates defined</p>
              <p className="text-xs mt-1">
                Add a custom rate to override automatically fetched exchange rates for specific date
                ranges.
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>End Date</TableHead>
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
                        {rate.EndDate || <span className="text-muted-foreground">Open</span>}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">How it works</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              <strong className="text-foreground">Custom rates take priority</strong> over
              automatically fetched rates when a matching date range exists.
            </li>
            <li>
              <strong className="text-foreground">Retroactive recalculation</strong> — adding or
              changing a rate recalculates all affected transactions that don't have a manual
              override.
            </li>
            <li>
              <strong className="text-foreground">Manual overrides are protected</strong> —
              transactions where you manually set the exchange rate in the table are never
              automatically changed.
            </li>
            <li>
              <strong className="text-foreground">Open-ended rates</strong> — leave the end date
              empty to apply the rate to all future dates.
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
        title="Delete custom rate?"
        description={
          <>
            This will delete the {deleteTarget?.FromCurrency} → {deleteTarget?.ToCurrency} rate (
            {deleteTarget?.StartDate} – {deleteTarget?.EndDate || 'open'}). Affected transactions
            will be recalculated using fallback rates.
          </>
        }
        confirmText="Delete"
        loadingText="Deleting..."
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
