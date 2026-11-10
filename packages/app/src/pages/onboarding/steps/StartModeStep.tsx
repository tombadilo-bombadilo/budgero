import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import React from 'react';
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
      <div
        className="bo-stack-mobile"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}
      >
        {modes.map((m) => {
          const active = state.startMode === m.id;
          return (
            <OnboardingOptionTile
              key={m.id}
              active={active}
              aria-pressed={active}
              onClick={() => set({ startMode: m.id })}
              borderAlpha={0.45}
              style={{
                padding: '18px 18px 16px',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  border: '1.5px solid #141414',
                  background: active ? '#141414' : 'transparent',
                  color: active ? '#fbf7eb' : '#141414',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {m.glyph}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                {m.title}
                {active && ' ✓'}
              </div>
              <div style={{ fontSize: 12, color: '#393939', lineHeight: 1.45 }}>{m.sub}</div>
              <ul
                className="bo-mode-bullets"
                data-active={active || undefined}
                style={{
                  margin: '6px 0 0',
                  padding: 0,
                  listStyle: 'none',
                  display: 'grid',
                  gap: 4,
                  fontSize: 11,
                  color: '#393939',
                }}
              >
                {m.bullets.map((b, i) => (
                  <li key={i} style={{ display: 'flex', gap: 6 }}>
                    <span style={{ color: '#c6392c' }}>–</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </OnboardingOptionTile>
          );
        })}
      </div>
      {!state.startMode && (
        <div style={{ marginTop: 14, fontSize: 11, color: '#393939', textAlign: 'center' }}>
          <Trans>Pick a path to continue.</Trans>
        </div>
      )}
    </div>
  );
};
