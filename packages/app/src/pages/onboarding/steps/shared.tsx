import { currencyDisplayFor } from '@shared/lib/number-format';
import type { MessageDescriptor } from '@lingui/core';
import { useLingui } from '@lingui/react/macro';
/* eslint-disable react-refresh/only-export-components */
// Shared bits for the onboarding step components: the common prop shape, the
// step title, the option tile and the field label, plus the currency-symbol
// helper a few steps need. Styling uses the app's own tokens, so onboarding
// looks like the app it leads into (and follows its theme).
import React from 'react';
import { cn } from '@shared/lib/utils';
import { CURRENCIES, type OnboardingFormState, type OnboardingStepDef } from '../onboarding-data';

export function getCurrencySym(code: string): string {
  const quickPick = CURRENCIES.find((c) => c.code === code)?.sym;
  if (quickPick) return quickPick;
  // Long-tail currencies come from the full dropdown, which carries no
  // symbol data — derive it via Intl, falling back to the code itself.
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      currencyDisplay: currencyDisplayFor(code),
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

export interface StepProps {
  cur: OnboardingStepDef;
  state: OnboardingFormState;
  set: (patch: Partial<OnboardingFormState>) => void;
}

export const Title: React.FC<{ h: MessageDescriptor; sub?: MessageDescriptor }> = ({ h, sub }) => {
  const { t } = useLingui();
  return (
    <div className="mb-4 md:mb-6">
      <h1 className="text-xl font-semibold leading-tight tracking-tight md:text-2xl">{t(h)}</h1>
      {sub && (
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">{t(sub)}</p>
      )}
    </div>
  );
};

/** Small label above a field or a group of options. */
export const FieldLabel: React.FC<{ children: React.ReactNode; htmlFor?: string }> = ({
  children,
  htmlFor,
}) => (
  <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
    {children}
  </label>
);

/**
 * A choice the user picks (way to start, currency, referral source). Picked
 * tiles get the primary outline; everything inside comes from children.
 */
export const OnboardingOptionTile: React.FC<{
  active: boolean;
  onClick: () => void;
  className?: string;
  /** Tiles that toggle a choice say whether it is picked. */
  'aria-pressed'?: boolean;
  children: React.ReactNode;
}> = ({ active, onClick, className, 'aria-pressed': ariaPressed, children }) => (
  <button
    type="button"
    aria-pressed={ariaPressed}
    onClick={onClick}
    className={cn(
      'rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active
        ? 'border-primary bg-primary/5 ring-1 ring-primary'
        : 'border-border bg-card hover:bg-muted/60',
      className
    )}
  >
    {children}
  </button>
);
