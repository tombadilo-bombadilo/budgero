import React from 'react';
import type { InviteInput } from '../onboarding-data';
import { OnboardingGhostButton, StepHeroImage, Title, type StepProps } from './shared';

export const ShareStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const maxSeats = 5;
  const { invites } = state;
  const updateInvite = (i: number, patch: Partial<InviteInput>) => {
    set({ invites: invites.map((inv, j) => (j === i ? { ...inv, ...patch } : inv)) });
  };
  const addInvite = () => {
    if (invites.length >= maxSeats) return;
    set({
      invites: [...invites, { id: Date.now(), email: '' }],
    });
  };
  const removeInvite = (i: number) => {
    set({ invites: invites.filter((_, j) => j !== i) });
  };
  return (
    <div>
      <StepHeroImage
        src="/onboarding-share.png"
        alt="Five characters tethered to a shared ledger"
      />
      <Title h={cur.title} sub={cur.subtitle} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          marginBottom: 14,
          border: '1px dashed rgba(57,57,57,0.5)',
          background: '#fbf7eb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, letterSpacing: 1.2, fontWeight: 700, color: '#393939' }}>
            SEATS USED
          </span>
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: maxSeats }).map((_, i) => (
              <span
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  border: '1px solid #141414',
                  background: i < invites.length ? '#c6392c' : 'transparent',
                }}
              />
            ))}
          </div>
        </div>
        <span
          style={{
            fontSize: 13,
            fontFamily: 'IBM Plex Mono, monospace',
            color: '#141414',
            fontWeight: 700,
          }}
        >
          {invites.length} / {maxSeats}
        </span>
      </div>

      {invites.length === 0 && (
        <div
          style={{
            padding: 20,
            textAlign: 'center',
            border: '1px dashed rgba(57,57,57,0.4)',
            background: '#fffdf8',
            fontSize: 12,
            color: '#393939',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>✉</div>
          Flying solo? Skip this step and invite people later.
          <div style={{ marginTop: 6, fontSize: 10, letterSpacing: 0.5, color: '#393939' }}>
            All 5 seats are free, included in your plan.
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {invites.map((inv, i) => (
            <div
              key={inv.id}
              style={{
                border: '1px dashed rgba(57,57,57,0.5)',
                background: '#fbf7eb',
                padding: 12,
                display: 'grid',
                gridTemplateColumns: '1fr 24px',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <input
                value={inv.email}
                onChange={(e) => updateInvite(i, { email: e.target.value })}
                placeholder="name@example.com"
                type="email"
                style={{
                  border: '1px solid #141414',
                  background: '#fffdf8',
                  padding: '8px 10px',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                onClick={() => removeInvite(i)}
                style={{
                  width: 24,
                  height: 24,
                  border: '1px dashed rgba(57,57,57,0.5)',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#393939',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <OnboardingGhostButton onClick={addInvite} disabled={invites.length >= maxSeats}>
        {invites.length >= maxSeats ? 'ALL 5 SEATS FILLED' : '+ INVITE SOMEONE'}
      </OnboardingGhostButton>

      <div
        style={{
          marginTop: 16,
          fontSize: 11,
          color: '#393939',
          lineHeight: 1.55,
        }}
      >
        Everyone you invite becomes a{' '}
        <span style={{ fontWeight: 700, color: '#141414' }}>collaborator</span> with the same view
        and edit rights you have. After we set up your workspace we’ll generate a private link for
        each person — Budgero never emails them on your behalf, you copy or send each link yourself
        so the secret stays off our servers.
      </div>
    </div>
  );
};
