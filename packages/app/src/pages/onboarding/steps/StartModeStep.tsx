import React from 'react';
import { OnboardingOptionTile, Title, type StepProps } from './shared';

export const StartModeStep: React.FC<StepProps> = ({ state, set }) => {
  const modes: {
    id: 'fresh' | 'ynab';
    title: string;
    sub: string;
    bullets: string[];
    glyph: string;
  }[] = [
    {
      id: 'fresh',
      title: 'Fresh start',
      sub: 'I’m new to zero-based budgeting, or starting clean.',
      bullets: [
        'Learn ZBB with a short walkthrough',
        'Set up accounts & envelopes by hand',
        'Takes about 2 minutes',
      ],
      glyph: '✎',
    },
    {
      id: 'ynab',
      title: 'Importing from YNAB',
      sub: 'I’ve got a budget elsewhere I want to bring over.',
      bullets: [
        'Accounts, categories, and balances come with you',
        'Transaction history preserved',
        'We skip the basics — you know the drill',
      ],
      glyph: '↳',
    },
  ];
  return (
    <div>
      <Title h="How are you starting?" sub="Budgero works either way. Pick the path that fits." />
      <div
        className="bo-stack-mobile"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 8 }}
      >
        {modes.map((m) => {
          const active = state.startMode === m.id;
          return (
            <OnboardingOptionTile
              key={m.id}
              active={active}
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
          Pick a path to continue.
        </div>
      )}
    </div>
  );
};
