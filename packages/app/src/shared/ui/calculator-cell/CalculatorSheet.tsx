import { Delete } from 'lucide-react';
import { Drawer, DrawerContent } from '@shared/ui/drawer';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { buttonizeProps } from '@shared/lib/a11y';
import { maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { triggerHapticFeedback } from '@shared/lib/haptics';
import { useUiStore } from '@shared/store/useUiStore';

export interface CalculatorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mobileText: string;
  setMobileText: React.Dispatch<React.SetStateAction<string>>;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  mobileError: string | null;
  setMobileError: React.Dispatch<React.SetStateAction<string | null>>;
  hasError: boolean;
  evaluatedValue: number | null;
  formatter: (value: number) => string;
  decimalSep: string;
  onCommit: (text: string) => void;
  onClose: () => void;
}

export function CalculatorSheet({
  open,
  onOpenChange,
  mobileText,
  setMobileText,
  setInputText,
  mobileError,
  setMobileError,
  hasError,
  evaluatedValue,
  formatter,
  decimalSep,
  onCommit,
  onClose,
}: CalculatorSheetProps) {
  const decimalButton = decimalSep || '.';

  const handleButtonClick = (item: { label: React.ReactNode; value?: string; action?: string }) => {
    triggerHapticFeedback(10);
    setMobileError(null);

    if (item.action === 'clear') {
      setMobileText('');
      setInputText('');
      return;
    }
    if (item.action === 'enter') {
      onCommit(mobileText);
      return;
    }
    if (item.action === 'toggle-sign') {
      setMobileText((t) => {
        const trimmed = t.trim();
        const next =
          trimmed.startsWith('-') && trimmed.length > 0
            ? trimmed.replace(/^-/, '')
            : trimmed
              ? `-${trimmed}`
              : '-';
        setInputText(next);
        return next;
      });
      return;
    }
    if (item.action === 'backspace') {
      setMobileText((t) => {
        const next = t.slice(0, -1);
        setInputText(next);
        return next;
      });
      return;
    }
    if (item.value) {
      setMobileText((t) => {
        const next = t + item.value;
        setInputText(next);
        return next;
      });
    }
  };

  const buttons = [
    { label: 'C', action: 'clear', key: 'clear', type: 'utility' },
    { label: String.fromCharCode(247), value: '/', key: 'divide', type: 'operator' },
    { label: String.fromCharCode(215), value: '*', key: 'multiply', type: 'operator' },
    {
      label: <Delete className="size-6 stroke-[1.5]" />,
      action: 'backspace',
      key: 'backspace',
      type: 'utility',
    },
    { label: '7', value: '7', key: '7', type: 'number' },
    { label: '8', value: '8', key: '8', type: 'number' },
    { label: '9', value: '9', key: '9', type: 'number' },
    { label: '-', value: '-', key: 'minus', type: 'operator' },
    { label: '4', value: '4', key: '4', type: 'number' },
    { label: '5', value: '5', key: '5', type: 'number' },
    { label: '6', value: '6', key: '6', type: 'number' },
    { label: '+', value: '+', key: 'plus', type: 'operator' },
    { label: '1', value: '1', key: '1', type: 'number' },
    { label: '2', value: '2', key: '2', type: 'number' },
    { label: '3', value: '3', key: '3', type: 'number' },
    { label: String.fromCharCode(177), action: 'toggle-sign', key: 'toggle-sign', type: 'utility' },
    { label: '0', value: '0', key: '0', type: 'number' },
    { label: decimalButton, value: decimalButton, key: 'dot', type: 'number' },
    {
      label: 'Enter',
      action: 'enter',
      key: 'enter',
      colSpan: 2,
      className: 'col-span-2 bg-primary text-primary-foreground hover:bg-primary/90',
      type: 'enter',
    },
  ];

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) onClose();
      }}
      modal={false}
    >
      <DrawerContent
        withOverlay={false}
        data-calculator-sheet="true"
        className="w-full max-w-full mx-auto sm:max-w-md data-[vaul-drawer-direction=bottom]:max-h-[100dvh]"
      >
        <div className="p-2 space-y-2">
          <div
            data-calculator-display="true"
            className="min-h-[2.5rem] px-3 py-2 rounded-lg border border-border/55 bg-card/80 flex items-center justify-between gap-2"
          >
            <div className="text-lg font-mono text-foreground truncate">
              {mobileText || <span className="text-foreground/45">0</span>}
            </div>
            <div className="text-right shrink-0">
              {mobileError ? (
                <div className="text-xs text-destructive">{mobileError}</div>
              ) : hasError && mobileText ? (
                <div className="text-xs text-destructive">Error</div>
              ) : evaluatedValue !== null && mobileText ? (
                <div className="text-sm text-foreground/65 font-mono">
                  = {formatter(evaluatedValue)}
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {buttons.map((item, idx) => {
              const spanClass = item.colSpan ? `col-span-${item.colSpan}` : '';
              const colorClass =
                item.action === 'enter'
                  ? ''
                  : item.type === 'number'
                    ? 'bg-card border border-border/45 text-foreground hover:bg-accent/45'
                    : item.type === 'operator'
                      ? 'bg-secondary border border-border/45 text-secondary-foreground hover:bg-secondary/85'
                      : 'bg-muted border border-border/45 text-foreground hover:bg-muted/80';
              const itemKey =
                typeof item.label === 'string'
                  ? item.label
                  : typeof item.key === 'string'
                    ? item.key
                    : `key-${idx}`;
              return (
                <Button
                  key={itemKey}
                  type="button"
                  variant={item.action === 'enter' ? 'default' : 'secondary'}
                  data-calculator-key="true"
                  data-key-type={item.type}
                  aria-label={typeof item.label === 'string' ? undefined : 'Delete'}
                  className={cn(
                    'h-12 text-lg font-semibold active:scale-[0.985] transition-transform',
                    item.action === 'enter' ? 'rounded-md' : 'rounded-full',
                    spanClass,
                    colorClass,
                    item.className
                  )}
                  onClick={() => handleButtonClick(item)}
                >
                  {item.label}
                </Button>
              );
            })}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export interface MobileTriggerProps {
  value: number;
  inputText: string;
  mobileText: string;
  zeroAsEmpty: boolean;
  placeholder: string;
  useFormatterForDisplay: boolean;
  isEditing: boolean;
  displayFormatter: (value: number) => string;
  displayClassName?: string;
  inputClassName?: string;
  formatValueForInput: (val: number) => string;
  localizer?: Intl.NumberFormat;
  setMobileText: React.Dispatch<React.SetStateAction<string>>;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  setMobileOpen: (open: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

export function MobileTrigger({
  value,
  inputText,
  mobileText,
  zeroAsEmpty,
  placeholder,
  useFormatterForDisplay,
  isEditing,
  displayFormatter,
  displayClassName,
  inputClassName,
  formatValueForInput,
  localizer,
  setMobileText,
  setInputText,
  setMobileOpen,
  onEditingChange,
}: MobileTriggerProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  // Helper to format value for editing (respects locale decimal separator)
  const getEditableValue = () => {
    if (value === 0) return '';
    try {
      return localizer ? formatValueForInput(value) : value.toString();
    } catch {
      return value.toString();
    }
  };

  const handleClick = () => {
    const seed = getEditableValue();
    setMobileText(seed);
    setInputText(seed);
    setMobileOpen(true);
    onEditingChange?.(true);
  };

  if (useFormatterForDisplay) {
    const maskedDisplayValue = maskFormattedIfEnabled(displayFormatter(value), privacyMaskNumbers);
    const displayContent = isEditing ? (
      mobileText || inputText
    ) : value === 0 && zeroAsEmpty ? (
      <span className="text-muted-foreground">{placeholder}</span>
    ) : (
      maskedDisplayValue
    );
    return (
      <div
        className={cn('cursor-pointer truncate', displayClassName)}
        {...buttonizeProps(handleClick)}
      >
        {displayContent}
      </div>
    );
  }

  const displayRaw =
    value === 0 && zeroAsEmpty && !mobileText ? '' : inputText || displayFormatter(value);
  const display = isEditing ? displayRaw : maskFormattedIfEnabled(displayRaw, privacyMaskNumbers);
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'w-full justify-center text-center h-9 px-3 bg-background border-input hover:bg-muted/40',
        value === 0 && zeroAsEmpty && !mobileText ? 'text-muted-foreground' : '',
        'font-mono',
        inputClassName
      )}
      onClick={() => {
        setMobileText(inputText || '');
        setMobileOpen(true);
        onEditingChange?.(true);
      }}
    >
      <span className="truncate">{display}</span>
    </Button>
  );
}
