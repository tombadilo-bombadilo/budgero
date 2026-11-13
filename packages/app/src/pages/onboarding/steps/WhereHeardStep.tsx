import { Trans, useLingui } from '@lingui/react/macro';
import React, { useId } from 'react';
import { cn } from '@shared/lib/utils';
import { Input } from '@shared/ui/input';
import { HEARD_OPTIONS } from '../onboarding-data';
import { FIELD_CLASS, OnboardingOptionTile, Title, type StepProps } from './shared';

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
          className={cn(FIELD_CLASS, 'mt-3')}
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
 * The same question as optional wrapping chips, shown under the password
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
      {/* Chips wrap onto as many lines as they need, so every option is
          visible without sideways scrolling; a label longer than the screen
          wraps inside its chip. */}
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {HEARD_OPTIONS.map((opt) => {
          const active = state.heardSource === opt.id;
          return (
            <OnboardingOptionTile
              key={opt.id}
              active={active}
              aria-pressed={active}
              onClick={() => set({ heardSource: active ? '' : opt.id })}
              className="max-w-full break-words rounded-full px-2.5 py-1 text-xs"
            >
              {t(opt.label)}
            </OnboardingOptionTile>
          );
        })}
      </div>
      {state.heardSource === 'other' && (
        <Input
          className={cn(FIELD_CLASS, 'mt-2 h-8 text-sm')}
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
