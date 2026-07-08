import React from 'react';
import { REWARD_TIERS } from '../onboarding-data';
import { Title, type StepProps } from './shared';

export const RewardsStep: React.FC<StepProps> = ({ cur }) => (
  <div>
    <Title h={cur.title} sub={cur.subtitle} />
    <div
      style={{ marginTop: 4, marginBottom: 14, fontSize: 13, color: '#393939', lineHeight: 1.5 }}
    >
      The more the habit sticks during your 35-day trial, the bigger the discount:
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {REWARD_TIERS.map((tier) => (
        <div
          key={tier.percent}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
            border: '1px dashed rgba(57,57,57,0.45)',
            background: '#fffdf8',
          }}
        >
          <div
            style={{
              minWidth: 58,
              textAlign: 'center',
              fontSize: 22,
              fontWeight: 700,
              color: '#c6392c',
              lineHeight: 1,
            }}
          >
            {tier.percent}%
          </div>
          <div style={{ fontSize: 13, color: '#393939', lineHeight: 1.45 }}>{tier.label}</div>
        </div>
      ))}
    </div>
    <p style={{ marginTop: 16, fontSize: 11, color: 'rgba(57,57,57,0.7)', lineHeight: 1.55 }}>
      The discount applies to the yearly plan for your first two years, then renews at the regular
      price. Codes are earned automatically and apply at checkout — there’s nothing to claim. Track
      your progress anytime from your dashboard.
    </p>
  </div>
);
