import React from 'react';
import { ACCOUNT_TYPES, type AccountInput } from '../onboarding-data';
import {
  OnboardingGhostButton,
  StepHeroImage,
  Title,
  getCurrencySym,
  type StepProps,
} from './shared';

export const AccountsStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const addAccount = () =>
    set({
      accounts: [...state.accounts, { id: Date.now(), type: 'checking', name: '', balance: '' }],
    });
  const updateAcct = (id: number, patch: Partial<AccountInput>) =>
    set({ accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const removeAcct = (id: number) => set({ accounts: state.accounts.filter((a) => a.id !== id) });
  return (
    <div>
      <StepHeroImage
        src="/onboarding-accounts.png"
        alt="Coin character with checking register, savings jar, and credit card"
      />
      <Title h={cur.title} sub={cur.subtitle} />
      <div style={{ display: 'grid', gap: 10 }}>
        {state.accounts.map((a) => {
          const type = ACCOUNT_TYPES.find((t) => t.id === a.type) ?? ACCOUNT_TYPES[0];
          return (
            <div
              key={a.id}
              className="bo-account-row"
              style={{
                border: '1px dashed rgba(57,57,57,0.5)',
                background: '#fbf7eb',
                padding: 12,
                display: 'grid',
                gridTemplateColumns: '120px 1fr 120px 24px',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <select
                className="bo-account-type"
                value={a.type}
                onChange={(e) => updateAcct(a.id, { type: e.target.value as AccountInput['type'] })}
                style={{
                  border: '1px solid #141414',
                  background: '#fffdf8',
                  padding: '8px 10px',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  minWidth: 0,
                }}
              >
                {ACCOUNT_TYPES.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
              <input
                className="bo-account-name"
                value={a.name}
                onChange={(e) => updateAcct(a.id, { name: e.target.value })}
                placeholder={`${type.name} name`}
                style={{
                  border: '1px solid #141414',
                  background: '#fffdf8',
                  padding: '8px 10px',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  outline: 'none',
                  minWidth: 0,
                }}
              />
              <div
                className="bo-account-balance"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: '1px solid #141414',
                  background: '#fffdf8',
                  minWidth: 0,
                }}
              >
                <span style={{ padding: '0 8px', color: '#393939' }}>
                  {getCurrencySym(state.currency)}
                </span>
                <input
                  value={a.balance}
                  onChange={(e) => updateAcct(a.id, { balance: e.target.value })}
                  placeholder={type.isDebt ? 'Amount owed' : '0.00'}
                  aria-label={`${type.balanceLabel} for ${a.name.trim() || type.name}`}
                  type="number"
                  min={type.isDebt ? 0 : undefined}
                  style={{
                    flex: 1,
                    width: '100%',
                    minWidth: 0,
                    border: 'none',
                    padding: '8px 0',
                    outline: 'none',
                    background: 'transparent',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    textAlign: 'right',
                  }}
                />
              </div>
              <button
                className="bo-account-remove"
                onClick={() => removeAcct(a.id)}
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
          );
        })}
      </div>
      {state.accounts.some((a) => a.type === 'credit') && (
        <p style={{ marginTop: 8, fontSize: 12, color: '#6b6b6b' }}>
          For credit cards, enter the amount you currently owe — the card will open with that
          balance as debt.
        </p>
      )}
      <OnboardingGhostButton onClick={addAccount}>+ ADD ANOTHER ACCOUNT</OnboardingGhostButton>
    </div>
  );
};
