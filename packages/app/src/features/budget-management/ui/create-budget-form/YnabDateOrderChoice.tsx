import { Trans, useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import type { YNABImportConfig } from '@budgero/core/browser';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';

type DateOrder = NonNullable<YNABImportConfig['dateOrder']>;

export function YnabDateOrderChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: DateOrder | undefined;
  onChange: (value: DateOrder) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const name = useId();

  return (
    <fieldset className="space-y-2 rounded-md border p-3 text-xs" disabled={disabled}>
      <legend className="px-1 font-medium">
        <Trans>Dates in this export</Trans>
      </legend>
      <p>
        <Trans>These dates can be read two ways. Select the date format used in YNAB.</Trans>
      </p>
      <RadioGroup
        value={value ?? ''}
        onValueChange={(next) => onChange(next as DateOrder)}
        disabled={disabled}
        aria-label={t`Dates in this export`}
        className="gap-2"
      >
        <Label
          htmlFor={`${name}-month`}
          className="min-h-11 cursor-pointer text-xs leading-normal font-normal md:min-h-8"
        >
          <Trans>
            <RadioGroupItem id={`${name}-month`} value="month-first" />
            Month first (MM/DD/YYYY): 09/01 is September 1
          </Trans>
        </Label>
        <Label
          htmlFor={`${name}-day`}
          className="min-h-11 cursor-pointer text-xs leading-normal font-normal md:min-h-8"
        >
          <Trans>
            <RadioGroupItem id={`${name}-day`} value="day-first" />
            Day first (DD/MM/YYYY): 09/01 is January 9
          </Trans>
        </Label>
      </RadioGroup>
    </fieldset>
  );
}
