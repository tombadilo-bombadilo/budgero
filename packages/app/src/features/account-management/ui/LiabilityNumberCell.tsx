import { fromDecimal, toDecimal } from '@shared/lib/currency/milli';
import { CalculatorCell } from '@shared/ui/calculator-cell';

interface LiabilityNumberCellProps {
  /** Decimal value: this cell edits plain numbers (money-as-decimal, APRs, term years). */
  value: number;
  onCommit: (value: number) => void;
  placeholder: string;
  localizer: Intl.NumberFormat;
}

/**
 * Plain-number editor for liability fields. Callers pass DECIMAL values (some
 * fields are money the caller converts with `fromDecimal` at the submit
 * boundary, others are dimensionless rates/years); the milliunit round-trip
 * here only bridges CalculatorCell's MilliUnits contract.
 */
export function LiabilityNumberCell({
  value,
  onCommit,
  placeholder,
  localizer,
}: LiabilityNumberCellProps) {
  return (
    <CalculatorCell
      value={fromDecimal(value)}
      onCommit={(milli) => onCommit(toDecimal(milli))}
      formatter={(val) => localizer.format(val)}
      localizer={localizer}
      placeholder={placeholder}
      zeroAsEmpty
      inputAlign="left"
      displayClassName="h-8 sm:h-9 flex items-center rounded-md border border-input bg-background px-3 text-sm"
      inputClassName="h-8 sm:h-9"
    />
  );
}
