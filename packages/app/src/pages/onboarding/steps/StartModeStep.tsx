import { useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import React from 'react';
import { cn } from '@shared/lib/utils';
import type { StartMode } from '../onboarding-data';
import { OnboardingOptionTile, Title, type StepProps } from './shared';

export const StartModeStep: React.FC<StepProps> = ({ state, set }) => {
  const { t } = useLingui();

  const modes: {
    id: StartMode;
    title: string;
    sub: string;
    bullets: string[];
    glyph: string;
  }[] = [
    {
      id: 'fresh',
      title: t`Start my own budget`,
      sub: t`New to zero-based budgeting, or starting clean.`,
      bullets: [
        t`We show you how it works as you go`,
        t`Add your accounts and pick categories`,
        t`Takes about 2 minutes`,
      ],
      glyph: '✎',
    },
    {
      id: 'ynab',
      title: t`Import from YNAB`,
      sub: t`Bring the budget you already have in YNAB.`,
      bullets: [
        t`Accounts, categories, and balances come with you`,
        t`Transaction history preserved`,
        t`We skip the basics — you know the drill`,
      ],
      glyph: '↳',
    },
    {
      id: 'demo',
      title: t`Try a demo budget`,
      sub: t`Explore a filled-in budget before setting up your own.`,
      bullets: [
        t`A year and a half of sample spending, reports and goals`,
        t`Click around: none of it is yours yet`,
        t`Start your own budget whenever you like`,
      ],
      glyph: '◎',
    },
  ];
  return (
    <div>
      <Title
        h={msg`Welcome to Budgero.`}
        sub={msg`Every coin you earn gets a job before you spend it. How do you want to start?`}
      />
      <div className="grid gap-2.5 md:grid-cols-3 md:gap-3">
        {modes.map((m) => {
          const active = state.startMode === m.id;
          return (
            <OnboardingOptionTile
              key={m.id}
              active={active}
              aria-pressed={active}
              onClick={() => set({ startMode: m.id })}
              className="flex items-start gap-3 p-3 md:flex-col md:gap-2 md:p-4"
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-md text-base font-semibold',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                )}
              >
                {m.glyph}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{m.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {m.sub}
                </span>
                {/* Phones show the details of the picked way only. */}
                <ul
                  className={cn(
                    'mt-2 space-y-1 text-xs text-muted-foreground',
                    !active && 'hidden md:block'
                  )}
                >
                  {m.bullets.map((b, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span aria-hidden className="text-primary">
                        –
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </span>
            </OnboardingOptionTile>
          );
        })}
      </div>
    </div>
  );
};
