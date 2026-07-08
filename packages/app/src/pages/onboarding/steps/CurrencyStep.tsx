import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { currencies as ALL_CURRENCIES } from '@features/currencies/model/currency-data';
import React from 'react';
import { CURRENCIES } from '../onboarding-data';
import { OnboardingOptionTile, Title, type StepProps } from './shared';

const GLOBE_SRC = '/onboarding-globe-currencies.png';

export const CurrencyStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const popularCodes = new Set(CURRENCIES.map((c) => c.code));
  // True when the user picked a currency from the long-tail dropdown rather
  // than one of the 8 quick-pick tiles. Lets us highlight the dropdown row
  // distinctly so the user sees that *something* is selected.
  const usingDropdown = !popularCodes.has(state.currency);

  return (
    <div>
      <div
        style={{
          margin: '-12px -24px 16px',
          display: 'flex',
          justifyContent: 'center',
          background: '#fffdf8',
        }}
      >
        <img
          src={GLOBE_SRC}
          alt="Globe with currencies orbiting around it"
          style={{
            width: '100%',
            maxWidth: 440,
            height: 'auto',
            display: 'block',
            mixBlendMode: 'multiply',
          }}
        />
      </div>
      <Title h={cur.title} sub={cur.subtitle} />

      {/* Quick picks — eight top currencies as editorial tiles, matching the
          paper aesthetic of the rest of the onboarding. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
          marginTop: 18,
        }}
      >
        {CURRENCIES.map((c) => {
          const active = state.currency === c.code;
          return (
            <OnboardingOptionTile
              key={c.code}
              active={active}
              onClick={() => set({ currency: c.code })}
              style={{
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                position: 'relative',
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  border: '1px solid #141414',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                  background: active ? '#141414' : 'transparent',
                  color: active ? '#fbf7eb' : '#141414',
                }}
              >
                {c.sym}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.code}</div>
                <div style={{ fontSize: 10, color: '#393939' }}>{c.name}</div>
              </div>
              {active && <span style={{ fontSize: 14 }}>✓</span>}
            </OnboardingOptionTile>
          );
        })}
      </div>

      {/* Long-tail picker — Budgero supports 168 currencies. The shadcn
          CurrencySelector handles search + region grouping + flags; we just
          drop it below the quick picks and let it own the long list. */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          border: usingDropdown ? '1.5px solid #141414' : '1px dashed rgba(57,57,57,0.4)',
          background: usingDropdown ? '#fbf7eb' : '#fffdf8',
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.2,
            fontWeight: 700,
            color: '#393939',
            marginBottom: 8,
          }}
        >
          NEED A DIFFERENT CURRENCY?
        </div>
        <div style={{ fontSize: 11, color: '#393939', lineHeight: 1.55, marginBottom: 10 }}>
          Search the full list — Budgero supports {ALL_CURRENCIES.length} currencies.
        </div>
        <CurrencySelector
          value={state.currency}
          onValueChange={(value) => set({ currency: value })}
          label={<span className="sr-only">Currency</span>}
        />
      </div>
    </div>
  );
};
