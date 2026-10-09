import { Trans, useLingui } from '@lingui/react/macro';
import * as React from 'react';
import { ArrowLeftRight, Check, ChevronsUpDown, PlusCircle, X } from 'lucide-react';
import { Button } from '@shared/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';
import { usePayees } from '@entities/payee/api/usePayees';

const EMPTY_PAYEES: string[] = [];

export interface PayeeComboboxProps {
  budgetId: number;
  value: string | null | undefined;
  onChange: (next: string) => void;
  placeholder?: string;
  triggerClassName?: string;
  popoverContentClassName?: string;
  disabled?: boolean;
  allowClear?: boolean;
  payees?: string[];
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accounts offered as "Transfer: <name>" entries (inline register row). */
  transferAccounts?: { ID: number; Name: string }[];
  onSelectTransfer?: (accountId: number) => void;
  /** Overrides the trigger text, e.g. the chosen transfer. */
  displayValue?: string;
}

/**
 * PayeeCombobox provides a searchable select with the ability to create new payees on the fly.
 * Payees are stored as strings on transactions, so creating a new payee simply returns the entered value.
 */
export function PayeeCombobox({
  budgetId,
  value,
  onChange,
  placeholder: placeholderProp,
  triggerClassName,
  popoverContentClassName,
  disabled = false,
  allowClear = true,
  payees: providedPayees,
  defaultOpen = false,
  onOpenChange,
  transferAccounts,
  onSelectTransfer,
  displayValue,
}: PayeeComboboxProps) {
  const { t } = useLingui();
  const placeholder = placeholderProp ?? t`Select or create payee`;
  const [open, setOpen] = React.useState(defaultOpen);
  const [search, setSearch] = React.useState('');
  const payeesQuery = usePayees(budgetId, providedPayees === undefined);
  const payees = providedPayees ?? payeesQuery.data ?? EMPTY_PAYEES;
  const isFetching = providedPayees === undefined && payeesQuery.isFetching;

  React.useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const normalizedValue = (value ?? '').trim();
  const normalizedSearch = search.trim();
  const existingPayees = React.useMemo(() => {
    const trimmed = payees.map((p) => p.trim()).filter((p) => p.length > 0);
    return Array.from(new Set(trimmed));
  }, [payees]);

  const hasExactMatch = React.useMemo(() => {
    if (!normalizedSearch) return false;
    return existingPayees.some(
      (p) => p.localeCompare(normalizedSearch, undefined, { sensitivity: 'accent' }) === 0
    );
  }, [existingPayees, normalizedSearch]);

  const handleSelect = React.useCallback(
    (next: string) => {
      const trimmed = next.trim();
      onChange(trimmed);
      setOpen(false);
      setSearch('');
    },
    [onChange]
  );

  const handleSelectTransfer = React.useCallback(
    (accountId: number) => {
      onSelectTransfer?.(accountId);
      setOpen(false);
      setSearch('');
    },
    [onSelectTransfer]
  );

  const handleClear = React.useCallback(() => {
    onChange('');
    setOpen(false);
    setSearch('');
  }, [onChange]);

  React.useEffect(() => {
    if (open) {
      setSearch(normalizedValue);
    }
  }, [open, normalizedValue]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between text-left font-normal',
            !normalizedValue && !displayValue && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className="truncate">
            {displayValue || (normalizedValue.length > 0 ? normalizedValue : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0 max-h-[50dvh] overflow-hidden', popoverContentClassName)}
        align="start"
      >
        <Command className="h-full" loop>
          <CommandInput
            placeholder={t`Search payees…`}
            value={search}
            onValueChange={setSearch}
            disabled={isFetching}
          />
          <CommandList className="overflow-y-auto overscroll-contain touch-pan-y max-h-[44dvh]">
            <CommandEmpty>
              {normalizedSearch
                ? t`No matching payees. Use "Create" below.`
                : t`Type to search payees.`}
            </CommandEmpty>
            {(normalizedSearch && !hasExactMatch) || (allowClear && normalizedValue) ? (
              <CommandGroup heading={t`Actions`}>
                {normalizedSearch && !hasExactMatch && (
                  <CommandItem
                    value={`__create__::${normalizedSearch}`}
                    onSelect={() => handleSelect(normalizedSearch)}
                    className="flex items-center gap-2"
                  >
                    <PlusCircle className="h-4 w-4" />
                    <span>
                      <Trans>Create "{normalizedSearch}"</Trans>
                    </span>
                  </CommandItem>
                )}
                {allowClear && normalizedValue && (
                  <CommandItem
                    value="__clear__"
                    onSelect={handleClear}
                    className="flex items-center gap-2"
                  >
                    <X className="h-4 w-4" />
                    <span>
                      <Trans>Clear payee</Trans>
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            ) : null}
            {transferAccounts && transferAccounts.length > 0 && (
              <CommandGroup heading={t`Transfers`}>
                {transferAccounts.map((account) => (
                  <CommandItem
                    key={`transfer-${account.ID}`}
                    value={`__transfer__::${account.ID}::${t`Transfer`} ${account.Name}`}
                    onSelect={() => handleSelectTransfer(account.ID)}
                    className="flex items-center gap-2"
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                    <span className="truncate">
                      <Trans>Transfer: {account.Name}</Trans>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={t`Payees`}>
              {existingPayees.map((payee) => (
                <CommandItem
                  key={payee}
                  value={payee}
                  onSelect={() => handleSelect(payee)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      'h-4 w-4',
                      payee.localeCompare(normalizedValue, undefined, {
                        sensitivity: 'accent',
                      }) === 0
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{payee}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
