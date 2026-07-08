import * as React from 'react';
import { PayeeCombobox } from '@features/payees/ui/PayeeCombobox';

interface PayeeSelectCellProps {
  budgetId: number;
  value?: string | null;
  onCommit: (nextValue: string) => void;
  triggerClassName?: string;
  allowClear?: boolean;
}

export function PayeeSelectCell({
  budgetId,
  value,
  onCommit,
  triggerClassName,
  allowClear = true,
}: PayeeSelectCellProps) {
  const [internalValue, setInternalValue] = React.useState(value ?? '');

  React.useEffect(() => {
    setInternalValue(value ?? '');
  }, [value]);

  const handleChange = React.useCallback(
    (next: string) => {
      setInternalValue(next);
      onCommit(next);
    },
    [onCommit]
  );

  return (
    <PayeeCombobox
      budgetId={budgetId}
      value={internalValue}
      onChange={handleChange}
      triggerClassName={triggerClassName}
      allowClear={allowClear}
    />
  );
}
