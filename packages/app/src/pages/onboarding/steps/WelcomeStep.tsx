import React from 'react';
import { Title, type StepProps } from './shared';

const WELCOME_SRC = '/onboarding-welcome.png';

export const WelcomeStep: React.FC<StepProps> = ({ state }) => {
  // Invitee shortcut: the user landed here via /join#code=…, so they're
  // joining someone else's workspace, not building their own. Drop the
  // 6-step journey illustration (misleading — they only see two screens
  // before being dropped into the existing budget) and reframe the copy.
  if (state.joinSecret) {
    return (
      <div>
        <Title
          h="You’re joining a Budgero workspace."
          sub="Someone shared their budget with you. We’ll set up an encryption key on this device, then drop you straight into their ledger — no setup of your own required."
        />
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '24px 0 0',
            display: 'grid',
            gap: 12,
            fontSize: 13,
            color: '#393939',
          }}
        >
          {[
            'Pick a master password — your encryption key on this device.',
            'We’ll redeem the invite and unlock the shared workspace.',
            'You land on the dashboard with their budget ready to go.',
          ].map((s, i) => (
            <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  border: '1px solid #141414',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
        <div
          style={{
            marginTop: 18,
            padding: 12,
            border: '1px dashed rgba(57,57,57,0.4)',
            background: '#fbf7eb',
            fontSize: 11,
            color: '#393939',
            lineHeight: 1.55,
          }}
        >
          <span style={{ fontWeight: 700, color: '#141414', letterSpacing: 0.5 }}>HEADS UP:</span>{' '}
          Your master password encrypts the shared workspace key on this device. Pick something
          memorable — Budgero never sees it and we can’t reset it for you.
        </div>
      </div>
    );
  }
  return (
    <div>
      <Title
        h="Welcome to Budgero."
        sub="We’ll walk through it together. The idea is simple: every coin you earn gets a job before you spend it. Here’s what we’ll do, in six small steps."
      />
      <div
        style={{
          margin: '24px -24px 0',
          display: 'flex',
          justifyContent: 'center',
          background: '#fffdf8',
        }}
      >
        {/* The illustration is itself the journey checklist — six labelled
            step icons across the top + a friendly coin at the bottom. We
            drop the prior numbered text list since the visual covers it. */}
        <img
          src={WELCOME_SRC}
          alt="Your journey in six steps: rules, currency, ZBB, name your budget, accounts, password"
          style={{
            width: '100%',
            maxWidth: 720,
            height: 'auto',
            display: 'block',
            mixBlendMode: 'multiply',
          }}
        />
      </div>
    </div>
  );
};
