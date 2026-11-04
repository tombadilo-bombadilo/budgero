import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { HEARD_OPTIONS } from '../onboarding-data';
import { INK, OnboardingOptionTile, Title, type StepProps } from './shared';

export const WhereHeardStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const { t } = useLingui();

  return (
    <div>
      <Title h={cur.title} sub={cur.subtitle} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {HEARD_OPTIONS.map((opt) => {
          const active = state.heardSource === opt.id;
          return (
            <OnboardingOptionTile
              key={opt.id}
              type="button"
              active={active}
              onClick={() => set({ heardSource: opt.id })}
              borderAlpha={0.45}
              style={{
                padding: '14px 16px',
                fontSize: 14,
                fontWeight: 600,
                color: INK,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 16,
                  height: 16,
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: '1.5px solid #141414',
                  background: active ? '#141414' : 'transparent',
                  boxShadow: active ? 'inset 0 0 0 3px #fffdf8' : 'none',
                }}
              />
              {t(opt.label)}
            </OnboardingOptionTile>
          );
        })}
      </div>
      {state.heardSource === 'other' && (
        <div style={{ marginTop: 14 }}>
          <input
            type="text"
            value={state.heardOther}
            onChange={(e) => set({ heardOther: e.target.value })}
            placeholder={t`Tell us where…`}
            maxLength={120}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1px dashed rgba(57,57,57,0.55)',
              background: '#fffdf8',
              padding: '12px 14px',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 14,
              color: '#141414',
              outline: 'none',
            }}
          />
        </div>
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

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 8 }}>
        <Trans>Where did you hear about Budgero? (optional)</Trans>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {HEARD_OPTIONS.map((opt) => {
          const active = state.heardSource === opt.id;
          return (
            <OnboardingOptionTile
              key={opt.id}
              type="button"
              active={active}
              aria-pressed={active}
              onClick={() => set({ heardSource: active ? '' : opt.id })}
              borderAlpha={0.45}
              style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, color: INK }}
            >
              {t(opt.label)}
            </OnboardingOptionTile>
          );
        })}
      </div>
      {state.heardSource === 'other' && (
        <input
          type="text"
          value={state.heardOther}
          onChange={(e) => set({ heardOther: e.target.value })}
          placeholder={t`Tell us where…`}
          aria-label={t`Tell us where…`}
          maxLength={120}
          style={{
            marginTop: 8,
            width: '100%',
            boxSizing: 'border-box',
            border: '1px dashed rgba(57,57,57,0.55)',
            background: '#fffdf8',
            padding: '8px 12px',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 13,
            color: '#141414',
            outline: 'none',
          }}
        />
      )}
    </div>
  );
};
