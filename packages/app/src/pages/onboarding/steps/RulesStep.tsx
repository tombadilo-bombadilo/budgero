import React from 'react';
import type { StepProps } from './shared';

export const RulesStep: React.FC<StepProps> = ({ state, set }) => {
  const acknowledgeId = React.useId();
  const rules = [
    {
      n: 'I.',
      title: 'Only money you have now',
      body: 'No projections, no credit limits. We budget paychecks that have actually landed — never money you hope will arrive.',
      icon: '/onboarding-rules-wallet.png',
      alt: 'Wallet with cash',
    },
    {
      n: 'II.',
      title: 'Every dollar gets a job',
      body: "Rent, groceries, future-you. If a coin walks into Budgero with no assignment, it doesn't leave the front desk.",
      icon: '/onboarding-rules-worker.png',
      alt: 'Coin character with hardhat and briefcase',
    },
    {
      n: 'III.',
      title: 'You are the accountant',
      body: "Transactions are entered by hand — no bank sync, no background fetch. Slow is the feature. You'll feel every transaction.",
      icon: '/onboarding-rules-clipboard.png',
      alt: 'Clipboard with checkmarks',
    },
  ];
  return (
    <div>
      {/* Two-column hero: title + intro left, hero illustration right. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'center',
          marginBottom: 32,
          marginTop: -8,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 52,
              fontWeight: 700,
              letterSpacing: -0.8,
              lineHeight: 1.0,
              color: '#141414',
            }}
          >
            Three
            <br />
            house rules.
          </h1>
          {/* Orange marker-style accent under the title. */}
          <div
            style={{
              width: 80,
              height: 5,
              background: '#f97316',
              borderRadius: 2,
              marginTop: 18,
              marginBottom: 20,
            }}
          />
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: '#393939',
              lineHeight: 1.65,
            }}
          >
            Budgero is opinionated on purpose. These three rules shape everything — read them once,
            and the rest of the app will make sense.
          </p>
        </div>
        <img
          src="/onboarding-rules-hero.png"
          alt="Coin character pointing at a House Rules board"
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            mixBlendMode: 'multiply',
          }}
        />
      </div>

      {/* Rule cards: icon | numeral | title + body. */}
      <div style={{ display: 'grid', gap: 12 }}>
        {rules.map((r) => (
          <div
            key={r.n}
            style={{
              border: '1px dashed rgba(57,57,57,0.45)',
              background: '#fbf7eb',
              padding: '16px 20px',
              display: 'grid',
              gridTemplateColumns: '76px 36px minmax(0, 1fr)',
              gap: 16,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 76,
                height: 76,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={r.icon}
                alt={r.alt}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  mixBlendMode: 'multiply',
                  display: 'block',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'Georgia, serif',
                fontStyle: 'italic',
                fontSize: 26,
                fontWeight: 700,
                color: '#c6392c',
                lineHeight: 1,
                textAlign: 'center',
              }}
            >
              {r.n}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#141414' }}>
                {r.title}
              </div>
              <div style={{ fontSize: 12, color: '#393939', lineHeight: 1.55 }}>{r.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Acknowledgement. Style softens to green-tinted card once checked. */}
      <label
        htmlFor={acknowledgeId}
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          marginTop: 16,
          padding: '14px 16px',
          border: '1px dashed rgba(57,57,57,0.4)',
          background: state.acknowledgedRules ? 'rgba(47,125,49,0.08)' : '#fffdf8',
          cursor: 'pointer',
        }}
      >
        <input
          id={acknowledgeId}
          type="checkbox"
          checked={state.acknowledgedRules}
          onChange={(e) => set({ acknowledgedRules: e.target.checked })}
          style={{ marginTop: 2, accentColor: '#141414', width: 16, height: 16 }}
        />
        <span style={{ fontSize: 12, color: '#141414', lineHeight: 1.55 }}>
          I understand. I will budget only the money I have, assign every coin, and enter
          transactions myself.
        </span>
      </label>
    </div>
  );
};
