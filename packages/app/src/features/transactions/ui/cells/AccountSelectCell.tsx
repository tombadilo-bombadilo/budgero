import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';

interface AccountSelectCellProps {
  accountName: string | null | undefined;
  onCommit: (newAccountId: number) => void;
  triggerClassName?: string;
}

export function AccountSelectCell({
  accountName,
  onCommit,
  triggerClassName,
}: AccountSelectCellProps) {
  const { selectedBudget } = useUiStore();
  const { data: allAccounts = [], isLoading } = useAccounts(selectedBudget?.ID || 0);
  // Hide archived accounts from the picker, but keep the current selection visible if it
  // happens to be an archived account (so the cell still displays its name).
  const accounts = React.useMemo(
    () => allAccounts.filter((a) => !a.Archived || a.Name === accountName),
    [allAccounts, accountName]
  );

  const currentAccount = accounts.find((a) => a.Name === accountName);
  const [selectedValue, setSelectedValue] = React.useState<string>(
    currentAccount?.ID?.toString() || ''
  );

  React.useEffect(() => {
    const account = accounts.find((a) => a.Name === accountName);
    setSelectedValue(account?.ID?.toString() || '');
  }, [accountName, accounts]);

  const handleChange = (value: string) => {
    setSelectedValue(value);
    const accountId = parseInt(value, 10);
    if (!isNaN(accountId)) {
      onCommit(accountId);
    }
  };

  return (
    <Select value={selectedValue} onValueChange={handleChange} disabled={isLoading}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={isLoading ? 'Loading...' : 'Select account'} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.ID} value={account.ID.toString()}>
            {account.Name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
