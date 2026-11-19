import { Trans, useLingui } from '@lingui/react/macro';
import { Plus, Trash2 } from 'lucide-react';
import {
  nextRateChange,
  normalizeRateSchedule,
  validateRateSchedule,
  type InterestRateEntry,
} from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { DatePickerButton } from '@shared/ui/DatePickerButton';
import { getTodayISO } from '@shared/lib/date-utils';
import { RateChangeHint } from '@features/debt/ui/RateChangeHint';
import { formatRatePercent } from '@features/debt/lib/rate-schedule';
import { LiabilityNumberCell } from './LiabilityNumberCell';
import { currentFormRate } from '../lib/edit-account-metadata';

interface InterestRateScheduleEditorProps {
  /** Row 0 is the initial rate; later rows are dated changes. */
  rates: InterestRateEntry[];
  onChange: (rates: InterestRateEntry[]) => void;
  localizer: Intl.NumberFormat;
}

/** The initial-rate cell: sits where the single APR field always was. */
export function InitialRateCell({ rates, onChange, localizer }: InterestRateScheduleEditorProps) {
  return (
    <LiabilityNumberCell
      value={rates[0]?.rate_annual ?? 0}
      onCommit={(value) => onChange([{ rate_annual: value }, ...rates.slice(1)])}
      placeholder="e.g. 5.25"
      localizer={localizer}
    />
  );
}

/**
 * Dated rate changes below the initial rate: a compact list of date + rate
 * rows with add/remove. Rows keep the order they were entered in while
 * editing; the saved schedule is sorted by date.
 */
export function RateChangesEditor({ rates, onChange, localizer }: InterestRateScheduleEditorProps) {
  const { t } = useLingui();
  const changes = rates.slice(1);
  const validation = validateRateSchedule(rates);
  const today = getTodayISO();
  const nextChange = nextRateChange(normalizeRateSchedule(rates), today);

  const update = (index: number, patch: Partial<InterestRateEntry>) => {
    onChange(rates.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const remove = (index: number) => onChange(rates.filter((_, i) => i !== index));
  const add = () =>
    onChange([
      ...rates,
      { effective_date: today, rate_annual: rates[rates.length - 1]?.rate_annual ?? 0 },
    ]);

  const currentRate = formatRatePercent(currentFormRate(rates, today));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          <Trans>Rate changes</Trans>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
          <Trans>Add rate change</Trans>
        </Button>
      </div>
      {changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Trans>
            For variable or promotional rates, add the date each new rate starts. Future changes are
            included in payoff estimates.
          </Trans>
        </p>
      ) : (
        <ul className="space-y-2">
          {changes.map((row, offset) => {
            const index = offset + 1;
            const dateError = validation.badDates.includes(index)
              ? t`Pick the date this rate starts.`
              : validation.duplicateDates.includes(index)
                ? t`Another rate already starts on this date.`
                : null;
            const rateError = validation.badRates.includes(index)
              ? t`Enter a rate of 0% or more.`
              : null;
            return (
              <li key={index} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-2">
                  <DatePickerButton
                    value={row.effective_date ?? ''}
                    onChange={(value) => update(index, { effective_date: value })}
                    placeholder={t`Starts on`}
                  />
                  <LiabilityNumberCell
                    value={row.rate_annual}
                    onCommit={(value) => update(index, { rate_annual: value })}
                    placeholder="%"
                    localizer={localizer}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t`Remove rate change`}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {(dateError || rateError) && (
                  <p className="text-xs text-destructive">{dateError ?? rateError}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {changes.length > 0 && (
        <div className="text-xs text-muted-foreground">{t`In effect today: ${currentRate}%`}</div>
      )}
      <RateChangeHint next={nextChange} />
    </div>
  );
}
