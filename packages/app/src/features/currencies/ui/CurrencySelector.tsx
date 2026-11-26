import { Trans, useLingui } from '@lingui/react/macro';
import React, { useState, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import { Label } from '@shared/ui/label';
import { Button } from '@shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';
import { Check, ChevronsUpDown, Info } from 'lucide-react';
import { CryptoIcon } from '@entities/currency/ui/CryptoIcon';
import { CountryFlag } from '@shared/ui/country-flag';
import { cn } from '@shared/lib/utils';
import { useConnectivity } from '@shared/hooks/useConnectivity';
import {
  currencies,
  cryptoCurrencies,
  type CurrencyOption,
} from '@features/currencies/model/currency-data';

/** Flag for fiat entries; the coin's own icon for crypto (no country to show). */
function CurrencyGlyph({ currency, className }: { currency: CurrencyOption; className?: string }) {
  if (!currency.countryCode) {
    return <CryptoIcon code={currency.value} className={cn('h-[1.35em] w-[1.35em]', className)} />;
  }
  return (
    <CountryFlag
      countryCode={currency.countryCode}
      svg
      style={{ width: '1.5em', height: '1.5em' }}
      className={className}
    />
  );
}

interface CurrencySelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  compact?: boolean;
  /** Which currency kinds to offer. Crypto accounts pick from coins only,
   * fiat accounts and the budget display currency from fiat only; rate
   * settings mix both. */
  kind?: 'fiat' | 'crypto' | 'all';
  /**
   * Whether picking needs the rate API (account currencies do: the opening
   * balance is converted right away). False: always pickable, no runtime
   * needed (e.g. a goal's currency, converted later from any known rate).
   */
  needsConnection?: boolean;
  'data-testid'?: string;
}

const CurrencySelectorBody: React.FC<
  Omit<CurrencySelectorProps, 'needsConnection'> & { canUseCurrencyApi: boolean }
> = ({
  value,
  onValueChange,
  label,
  disabled = false,
  compact = false,
  kind = 'fiat',
  canUseCurrencyApi,
  'data-testid': testId,
}) => {
  const { t } = useLingui();

  const [open, setOpen] = useState(false);
  const isDisabled = disabled || !canUseCurrencyApi;

  const groupedCurrencies = useMemo(() => {
    const groups = new Map<string, CurrencyOption[]>();

    const options =
      kind === 'crypto'
        ? cryptoCurrencies
        : kind === 'all'
          ? [...cryptoCurrencies, ...currencies]
          : currencies;
    options.forEach((currency) => {
      if (!groups.has(currency.region)) {
        groups.set(currency.region, []);
      }
      const group = groups.get(currency.region);
      if (group) {
        group.push(currency);
      }
    });

    return Array.from(groups.entries());
  }, [kind]);

  // Search both lists so an existing crypto account renders its code even in
  // pickers that don't offer crypto.
  const selectedCurrency =
    currencies.find((cur) => cur.value === value) ??
    cryptoCurrencies.find((cur) => cur.value === value);

  return (
    <div className="flex flex-col space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor="currency" className="flex items-center gap-1">
          <span>{label ?? t`Currency`}</span>
          {!canUseCurrencyApi && (
            <span className="text-xs text-muted-foreground">
              <Trans>(Offline)</Trans>
            </span>
          )}
        </Label>
        {!canUseCurrencyApi && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  <Trans>
                    Currency conversion requires an internet connection to fetch current exchange
                    rates. You are currently offline.
                  </Trans>
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal h-8 sm:h-9 px-3"
            disabled={isDisabled}
            data-testid={testId}
          >
            {selectedCurrency ? (
              <div className="flex items-center">
                <CurrencyGlyph currency={selectedCurrency} />
                <span className="ml-2">
                  {compact ? selectedCurrency.value : selectedCurrency.label}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">
                <Trans>Select currency...</Trans>
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[300px] max-h-[50dvh] overflow-hidden"
          align="start"
          sideOffset={6}
          avoidCollisions
          collisionPadding={12}
        >
          <Command className="h-full">
            <CommandInput placeholder={t`Search currencies...`} />
            <CommandList className="max-h-[44dvh] overflow-y-auto overscroll-contain touch-pan-y">
              <CommandEmpty>
                <Trans>No currency found.</Trans>
              </CommandEmpty>
              {groupedCurrencies.map(([group, groupCurrencies]) => (
                <CommandGroup key={group} heading={group}>
                  {groupCurrencies.map((currency) => (
                    <CommandItem
                      key={currency.value}
                      value={currency.label}
                      onSelect={() => {
                        onValueChange(currency.value);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === currency.value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <CurrencyGlyph currency={currency} className="mr-2" />
                      <span className="truncate">{compact ? currency.value : currency.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

/** The connection-gated picker (reads connectivity from the runtime). */
const ConnectedCurrencySelector: React.FC<CurrencySelectorProps> = (props) => {
  const { clerkToken, apiReachable } = useConnectivity();
  return (
    <CurrencySelectorBody {...props} canUseCurrencyApi={Boolean(apiReachable && clerkToken)} />
  );
};

export const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  needsConnection = true,
  ...props
}) =>
  needsConnection ? (
    <ConnectedCurrencySelector {...props} />
  ) : (
    <CurrencySelectorBody {...props} canUseCurrencyApi />
  );
