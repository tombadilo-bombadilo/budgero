import { Trans, useLingui } from '@lingui/react/macro';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { currencies as ALL_CURRENCIES } from '@features/currencies/model/currency-data';
import React from 'react';
import { cn } from '@shared/lib/utils';
import { CURRENCIES } from '../onboarding-data';
import { OnboardingOptionTile, Title, type StepProps } from './shared';

export const CurrencyStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const { t } = useLingui();

  const popularCodes = new Set(CURRENCIES.map((c) => c.code));
  // True when the user picked a currency from the full list rather than one
  // of the quick picks, so that row shows as the selected one.
  const usingDropdown = !popularCodes.has(state.currency);

  return (
    <div>
      <Title h={cur.title} sub={cur.subtitle} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {CURRENCIES.map((c) => {
          const active = state.currency === c.code;
          return (
            <OnboardingOptionTile
              key={c.code}
              active={active}
              aria-pressed={active}
              onClick={() => set({ currency: c.code })}
              className="flex items-center gap-2.5 px-3 py-2"
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted'
                )}
              >
                {c.sym}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">{c.code}</span>
                <span className="block truncate text-[11px] text-muted-foreground md:whitespace-normal md:leading-tight">
                  {t(c.name)}
                </span>
              </span>
            </OnboardingOptionTile>
          );
        })}
      </div>

      {/* The full list (search, regions, flags) for every other currency. */}
      <div
        className={cn(
          'mt-3 rounded-lg border p-3',
          usingDropdown ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border'
        )}
      >
        <div className="mb-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            <Trans>NEED A DIFFERENT CURRENCY?</Trans>
          </span>{' '}
          <Trans>Search the full list — Budgero supports {ALL_CURRENCIES.length} currencies.</Trans>
        </div>
        <CurrencySelector
          value={state.currency}
          onValueChange={(value) => set({ currency: value })}
          label={
            <span className="sr-only">
              <Trans>Currency</Trans>
            </span>
          }
        />
      </div>
    </div>
  );
};
