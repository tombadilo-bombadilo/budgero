import { useLingui } from '@lingui/react/macro';
import { cn } from '@shared/lib/utils';
import { maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { useUiStore } from '@shared/store/useUiStore';
import { AMOUNT_SHORTCUT_KEYS } from '@shared/lib/keyboard-shortcuts';

export interface CalculatorDisplayProps {
  value: number;
  displayFormatter: (value: number) => string;
  placeholder: string;
  zeroAsEmpty: boolean;
  shortcuts: boolean;
  className?: string;
  displayClassName?: string;
  onStartEditing: () => void;
  editOnFocus: boolean;
}

export function CalculatorDisplay({
  value,
  displayFormatter,
  placeholder,
  zeroAsEmpty,
  shortcuts,
  className,
  displayClassName,
  onStartEditing,
  editOnFocus,
}: CalculatorDisplayProps) {
  const { t } = useLingui();
  const editHint = t`Click to edit - Calculator: 100 + 50, 1000 * 0.3`;
  const shortcutHint = () => {
    const { half, double, zero, tenPercent } = AMOUNT_SHORTCUT_KEYS;
    return t`Shortcuts: ${half} (half), ${double} (double), ${zero} (zero), ${tenPercent} (10%)`;
  };

  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const displayValue = displayFormatter(value);
  const maskedDisplayValue = maskFormattedIfEnabled(displayValue, privacyMaskNumbers);

  return (
    <div
      className={cn(
        'cursor-pointer transition-colors hover:bg-muted/40 rounded-md px-2 py-1 text-center',
        displayClassName,
        className
      )}
      onMouseDown={(e) => {
        // Prevent focus on mousedown so the div doesn't steal focus before being replaced
        // This ensures smooth focus transfer to the input that replaces this element
        e.preventDefault();
      }}
      onClick={onStartEditing}
      onFocus={() => {
        if (editOnFocus) onStartEditing();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onStartEditing();
        }
      }}
      tabIndex={0}
      role="button"
      title={shortcuts ? `${editHint} - ${shortcutHint()}` : editHint}
    >
      {value === 0 && zeroAsEmpty ? (
        <span className="text-muted-foreground">{placeholder}</span>
      ) : (
        maskedDisplayValue
      )}
    </div>
  );
}
