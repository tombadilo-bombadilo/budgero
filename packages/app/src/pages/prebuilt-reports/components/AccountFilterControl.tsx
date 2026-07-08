import { useEffect, useMemo } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';
import { MultiSelectFilterControl, type MultiSelectFilterGroup } from './MultiSelectFilterControl';

type AccountFilterControlProps = {
  selectedAccountIds: number[];
  onChange: (ids: number[]) => void;
  triggerClassName?: string;
  disabled?: boolean;
};

export function AccountFilterControl({
  selectedAccountIds,
  onChange,
  triggerClassName,
  disabled,
}: AccountFilterControlProps) {
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const { data: accounts = [], isLoading } = useAccounts(budgetId);

  useEffect(() => {
    if (!accounts.length) {
      if (selectedAccountIds.length > 0) {
        onChange([]);
      }
      return;
    }

    const accountSet = new Set(accounts.map((account) => account.ID));
    const filtered = selectedAccountIds.filter((id) => accountSet.has(id));
    if (filtered.length !== selectedAccountIds.length) {
      onChange(filtered);
    }
  }, [accounts, onChange, selectedAccountIds]);

  const onBudgetAccounts = useMemo(
    () => accounts.filter((account) => account.OnBudget && !account.Deleted),
    [accounts]
  );

  const buttonLabel = useMemo(() => {
    if (isLoading) {
      return 'Loading accounts...';
    }
    if (onBudgetAccounts.length === 0) {
      return 'No on-budget accounts';
    }
    if (selectedAccountIds.length === 0) {
      return 'All on-budget accounts';
    }
    if (selectedAccountIds.length === 1) {
      const account = onBudgetAccounts.find((item) => item.ID === selectedAccountIds[0]);
      return account?.Name ?? '1 account';
    }
    return `${selectedAccountIds.length} accounts`;
  }, [isLoading, onBudgetAccounts, selectedAccountIds]);

  const groups: MultiSelectFilterGroup<(typeof onBudgetAccounts)[number]>[] = useMemo(
    () => [{ key: 'accounts', heading: 'Accounts', items: onBudgetAccounts }],
    [onBudgetAccounts]
  );

  return (
    <MultiSelectFilterControl
      groups={groups}
      selectedIds={selectedAccountIds}
      onChange={onChange}
      getId={(account) => account.ID}
      getLabel={(account) => account.Name}
      isLoading={isLoading}
      hasItems={onBudgetAccounts.length > 0}
      buttonLabel={buttonLabel}
      triggerWidthClassName="sm:w-[240px]"
      contentClassName="w-[280px]"
      listClassName="max-h-64 overflow-y-auto"
      triggerClassName={triggerClassName}
      disabled={disabled}
      searchPlaceholder="Search accounts..."
      emptyText="No accounts found."
      allOptionLabel="All on-budget accounts"
      allOptionValue="__all_accounts__"
    />
  );
}
