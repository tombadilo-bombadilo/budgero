import React from 'react';
import { FieldLabel, InputRow, StepHeroImage, Title, type StepProps } from './shared';

export const PasswordStep: React.FC<StepProps> = ({ state, set }) => {
  const pw = state.password;
  const strength = (() => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  })();
  const strengthLabel = ['TOO SHORT', 'WEAK', 'OK', 'GOOD', 'STRONG', 'IRON-CLAD'][strength];
  const strengthColor = ['#c6392c', '#c6392c', '#f97316', '#facc15', '#2f7d31', '#2f7d31'][
    strength
  ];
  const matches = pw.length > 0 && pw === state.passwordConfirm;
  return (
    <div>
      <StepHeroImage
        src="/onboarding-password.png"
        alt="Coin character with a key approaching a Budgero padlock"
      />
      <Title
        h="Lock your ledger."
        sub="Your budget lives on your device, encrypted with a master password only you know. Pick something memorable — we can’t reset it for you."
      />
      <div style={{ display: 'grid', gap: 14, marginTop: 8 }}>
        <div>
          <FieldLabel>MASTER PASSWORD</FieldLabel>
          <InputRow
            big
            type="password"
            value={pw}
            onChange={(v) => set({ password: v })}
            placeholder="at least 8 characters"
          />
          {pw.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    style={{
                      flex: 1,
                      height: 4,
                      background: i < strength ? strengthColor : 'rgba(57,57,57,0.15)',
                    }}
                  />
                ))}
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: strengthColor,
                  letterSpacing: 1,
                }}
              >
                {strengthLabel}
              </span>
            </div>
          )}
        </div>
        <div>
          <FieldLabel>CONFIRM PASSWORD</FieldLabel>
          <InputRow
            type="password"
            value={state.passwordConfirm}
            onChange={(v) => set({ passwordConfirm: v })}
            placeholder="type it once more"
          />
          {state.passwordConfirm.length > 0 && (
            <div
              style={{
                marginTop: 6,
                fontSize: 10,
                color: matches ? '#2f7d31' : '#c6392c',
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              {matches ? '✓ MATCH' : '✗ DOES NOT MATCH'}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          marginTop: 18,
          padding: 12,
          border: '1px dashed rgba(57,57,57,0.5)',
          background: '#fbf7eb',
          fontSize: 11,
          color: '#393939',
          lineHeight: 1.55,
        }}
      >
        <div style={{ fontWeight: 700, color: '#c6392c', letterSpacing: 1, marginBottom: 4 }}>
          ⚠ READ THIS
        </div>
        Your budget is encrypted with this password on your device. We never see it. If you forget
        it, <span style={{ fontWeight: 700, color: '#141414' }}>your ledger is unrecoverable</span>{' '}
        — there is no reset email, no support line, no backdoor.
      </div>
    </div>
  );
};
