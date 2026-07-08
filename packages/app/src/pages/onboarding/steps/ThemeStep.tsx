import React from 'react';
import { THEMES_AVAILABLE } from '../onboarding-data';
import { OnboardingOptionTile, PAPER, Title, type StepProps } from './shared';

export const ThemeStep: React.FC<StepProps> = ({ cur, state, set }) => (
  <div>
    <Title h={cur.title} sub={cur.subtitle} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      {THEMES_AVAILABLE.map((th) => {
        const active = state.theme === th.id;
        return (
          <OnboardingOptionTile
            key={th.id}
            active={active}
            onClick={() => set({ theme: th.id })}
            // Keeps the same background whether active or not — the
            // preview swatch below already communicates selection, and the
            // dashed/solid border swap is enough of a signal on its own.
            activeBg={PAPER}
            style={{ padding: 0, overflow: 'hidden', position: 'relative' }}
          >
            {th.recommended && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 2,
                  background: '#c6392c',
                  color: '#fbf7eb',
                  fontSize: 8,
                  padding: '2px 6px',
                  letterSpacing: 1,
                  fontWeight: 700,
                }}
              >
                PICKED FOR YOU
              </div>
            )}
            <div
              style={{
                height: 86,
                background: th.bg,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                borderBottom: '1px dashed rgba(57,57,57,0.4)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: th.fg }}>BUDGERO</span>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: th.accent,
                  }}
                />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: th.fg }}>$12,840.00</div>
              <div style={{ display: 'flex', gap: 3 }}>
                <span style={{ width: 40, height: 4, background: th.accent }} />
                <span style={{ width: 24, height: 4, background: th.fg, opacity: 0.3 }} />
                <span style={{ width: 16, height: 4, background: th.accent, opacity: 0.5 }} />
              </div>
            </div>
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {th.name}
                {active && ' ✓'}
              </div>
              <div style={{ fontSize: 10, color: '#393939', marginTop: 2 }}>{th.tag}</div>
            </div>
          </OnboardingOptionTile>
        );
      })}
    </div>
  </div>
);
