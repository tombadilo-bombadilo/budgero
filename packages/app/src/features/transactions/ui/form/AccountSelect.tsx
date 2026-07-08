/**
 * Account Select Components
 *
 * From/To account selectors for transactions and transfers.
 */

import { CreditCard } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { AutofillIndicator } from '@shared/ui/autofill-indicator';

import type { TransactionType } from './TransactionTypeSelector';

interface Account {
  ID: number;
  Name?: string;
  Currency?: string;
}

interface FromAccountSelectProps {
  value: string;
  onChange: (value: string) => void;
  accounts: Account[];
  isLoading: boolean;
  transactionType: TransactionType;
  showAutofillIndicator?: boolean;
}

export function FromAccountSelect({
  value,
  onChange,
  accounts,
  isLoading,
  transactionType,
  showAutofillIndicator = false,
}: FromAccountSelectProps) {
  return (
    <div className="space-y-1.5 sm:space-y-2 w-full">
      <div className="flex items-center gap-2">
        {transactionType === 'transfer' ? (
          <span className="text-destructive font-semibold text-lg leading-none">−</span>
        ) : (
          <div className="relative">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <AutofillIndicator
              show={showAutofillIndicator}
              className="absolute -top-0.5 -right-0.5"
            />
          </div>
        )}
        <div className="flex-1">
          <Select value={value} onValueChange={onChange} disabled={isLoading}>
            <SelectTrigger
              className="h-8 sm:h-10 w-full"
              data-testid="transaction-from-account-select"
            >
              <SelectValue
                placeholder={
                  isLoading
                    ? 'Loading accounts...'
                    : transactionType === 'transfer'
                      ? 'Select from account'
                      : 'Select account'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.ID} value={account.ID.toString()}>
                  {account.Name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

interface ToAccountSelectProps {
  value: string;
  onChange: (value: string) => void;
  accounts: Account[];
  excludeAccountId: string;
  isLoading: boolean;
}

export function ToAccountSelect({
  value,
  onChange,
  accounts,
  excludeAccountId,
  isLoading,
}: ToAccountSelectProps) {
  const filteredAccounts = accounts.filter((account) => account.ID.toString() !== excludeAccountId);

  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center gap-2">
        <span className="text-success font-semibold text-lg leading-none">+</span>
        <div className="flex-1">
          <Select value={value} onValueChange={onChange} disabled={isLoading}>
            <SelectTrigger
              className="h-8 sm:h-10 w-full"
              data-testid="transaction-to-account-select"
            >
              <SelectValue placeholder={isLoading ? 'Loading accounts...' : 'Select to account'} />
            </SelectTrigger>
            <SelectContent>
              {filteredAccounts.map((account) => (
                <SelectItem key={account.ID} value={account.ID.toString()}>
                  {account.Name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
