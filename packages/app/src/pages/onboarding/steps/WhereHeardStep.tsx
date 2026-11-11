import { Trans, useLingui } from '@lingui/react/macro';
import React, { useId } from 'react';
import { cn } from '@shared/lib/utils';
import { Input } from '@shared/ui/input';
import { HEARD_OPTIONS } from '../onboarding-data';
import { OnboardingOptionTile, Title, type StepProps } from './shared';

export const WhereHeardStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const { t } = useLingui();

  return (
    <div>
      <Title h={cur.title} sub={cur.subtitle} />
      <div className="grid grid-cols-2 gap-2">
        {HEARD_OPTIONS.map((opt) => {
          const active = state.heardSource === opt.id;
          return (
            <OnboardingOptionTile
              key={opt.id}
              active={active}
              aria-pressed={active}
              onClick={() => set({ heardSource: opt.id })}
              className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium"
            >
              <span
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 rounded-full border',
                  active ? 'border-primary bg-primary ring-2 ring-inset ring-background' : ''
                )}
              />
              {t(opt.label)}
            </OnboardingOptionTile>
          );
        })}
      </div>
      {state.heardSource === 'other' && (
        <Input
          className="mt-3"
          value={state.heardOther}
          onChange={(e) => set({ heardOther: e.target.value })}
          placeholder={t`Tell us where…`}
          aria-label={t`Tell us where…`}
          maxLength={120}
        />
      )}
    </div>
  );
};

/**
 * The same question as one optional row of chips, shown under the password
 * on the fresh and YNAB paths (the invite path keeps the full step).
 */
export const WhereHeardPicker: React.FC<Pick<StepProps, 'state' | 'set'>> = ({ state, set }) => {
  const { t } = useLingui();
  const labelId = useId();

  return (
    <div className="mt-4">
      <div id={labelId} className="mb-1.5 text-xs font-medium text-muted-foreground">
        <Trans>Where did you hear about Budgero? (optional)</Trans>
      </div>
      {/* One row that scrolls sideways on a phone, so an optional question
          doesn't push the step past the screen. */}
      <div
        role="group"
        aria-labelledby={labelId}
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
      >
        {HEARD_OPTIONS.map((opt) => {
          const active = state.heardSource === opt.id;
          return (
            <OnboardingOptionTile
              key={opt.id}
              active={active}
              aria-pressed={active}
              onClick={() => set({ heardSource: active ? '' : opt.id })}
              className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs"
            >
              {t(opt.label)}
            </OnboardingOptionTile>
          );
        })}
      </div>
      {state.heardSource === 'other' && (
        <Input
          className="mt-2 h-8 text-sm"
          value={state.heardOther}
          onChange={(e) => set({ heardOther: e.target.value })}
          placeholder={t`Tell us where…`}
          aria-label={t`Tell us where…`}
          maxLength={120}
        />
      )}
    </div>
  );
};
