import * as React from 'react';
import { Input } from '@shared/ui/input';
import { parseTimeInput } from '@shared/lib/time-input';

interface TimeInputProps extends Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'defaultValue'
> {
  /** 'HH:MM', or '' for no time. */
  value: string;
  /** Called with 'HH:MM' or '' whenever the typed text is a time (or empty). */
  onValueChange: (time: string) => void;
}

/**
 * A typed 24-hour time field in the app's own input style (no browser time
 * picker). Text that is not a time is put back to the last value on blur.
 */
export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(
  ({ value, onValueChange, onBlur, placeholder = 'HH:MM', ...props }, ref) => {
    const [draft, setDraft] = React.useState(value);
    const lastSent = React.useRef(value);

    React.useEffect(() => {
      // Follow outside changes, but leave the text alone while it is being typed.
      if (value !== lastSent.current) {
        lastSent.current = value;
        setDraft(value);
      }
    }, [value]);

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const parsed = parseTimeInput(text);
          if (parsed !== null && parsed !== lastSent.current) {
            lastSent.current = parsed;
            onValueChange(parsed);
          }
        }}
        onBlur={(e) => {
          setDraft(lastSent.current);
          onBlur?.(e);
        }}
        {...props}
      />
    );
  }
);
TimeInput.displayName = 'TimeInput';
