import * as React from 'react';
import { PayeeCombobox, type PayeeComboboxProps } from '@features/payees/ui/PayeeCombobox';

interface PayeeSelectCellProps {
  budgetId: number;
  value?: string | null;
  onCommit: (nextValue: string) => void;
  triggerClassName?: string;
  allowClear?: boolean;
  payees?: string[];
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Transfer choices for editing existing rows; see PayeeCombobox.
  transferAccounts?: PayeeComboboxProps['transferAccounts'];
  onSelectTransfer?: PayeeComboboxProps['onSelectTransfer'];
  displayValue?: PayeeComboboxProps['displayValue'];
  selectedTransferAccountId?: PayeeComboboxProps['selectedTransferAccountId'];
  onUnlinkTransfer?: PayeeComboboxProps['onUnlinkTransfer'];
}

export function PayeeSelectCell({
  budgetId,
  value,
  onCommit,
  triggerClassName,
  allowClear = true,
  payees,
  defaultOpen,
  onOpenChange,
  transferAccounts,
  onSelectTransfer,
  displayValue,
  selectedTransferAccountId,
  onUnlinkTransfer,
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
      payees={payees}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      transferAccounts={transferAccounts}
      onSelectTransfer={onSelectTransfer}
      displayValue={displayValue}
      selectedTransferAccountId={selectedTransferAccountId}
      onUnlinkTransfer={onUnlinkTransfer}
    />
  );
}
