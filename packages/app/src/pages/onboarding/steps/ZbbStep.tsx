import React from 'react';
import { Title, getCurrencySym, type StepProps } from './shared';

export const ZbbStep: React.FC<StepProps> = ({ state, set }) => {
  const total = 2400;
  const sym = getCurrencySym(state.currency);
  const assigned =
    Number(state.zbbAssigned.rent || 0) +
    Number(state.zbbAssigned.groceries || 0) +
    Number(state.zbbAssigned.savings || 0);
  const remaining = total - assigned;
  const rows = [
    { key: 'rent' as const, label: 'Rent', color: '#14b8a6', hint: `suggested: ${sym}1,200` },
    {
      key: 'groceries' as const,
      label: 'Groceries',
      color: '#2f7d31',
      hint: `suggested: ${sym}450`,
    },
    { key: 'savings' as const, label: 'Savings', color: '#c6392c', hint: `suggested: ${sym}300` },
  ];
  return (
    <div>
      <Title
        h="Give every coin a job."
        sub="At the start of the month, take your income, and divide it across everything you need to pay for — rent, food, savings, fun. When the pile hits zero, you’re done. That’s the whole trick."
      />
      <div
        style={{
          border: '1px dashed rgba(57,57,57,0.5)',
          padding: 20,
          marginTop: 12,
          background: '#fbf7eb',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          <span style={{ color: '#393939' }}>THIS MONTH&apos;S PAYCHECK</span>
          <span style={{ fontWeight: 700 }}>
            {sym}
            {total.toLocaleString()}
          </span>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row) => (
            <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 12,
                  height: 12,
                  background: row.color,
                  border: '1px solid #141414',
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</div>
                <div style={{ fontSize: 10, color: '#393939', letterSpacing: 0.3 }}>{row.hint}</div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: '1px solid #141414',
                  background: '#fffdf8',
                }}
              >
                <span
                  style={{
                    padding: '6px 8px',
                    borderRight: '1px solid #141414',
                    fontSize: 13,
                    color: '#393939',
                  }}
                >
                  {sym}
                </span>
                <input
                  type="number"
                  value={state.zbbAssigned[row.key]}
                  onChange={(e) =>
                    set({ zbbAssigned: { ...state.zbbAssigned, [row.key]: e.target.value } })
                  }
                  style={{
                    width: 80,
                    border: 'none',
                    padding: '6px 10px',
                    outline: 'none',
                    background: 'transparent',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: 13,
                    textAlign: 'right',
                  }}
                  placeholder="0"
                />
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px dashed rgba(57,57,57,0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 12, color: '#393939' }}>LEFT TO ASSIGN</span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: remaining === 0 ? '#2f7d31' : remaining < 0 ? '#c6392c' : '#141414',
            }}
          >
            {remaining < 0 ? '−' : ''}
            {sym}
            {Math.abs(remaining).toLocaleString()}
          </span>
        </div>
        {remaining === 0 && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: 'rgba(47,125,49,0.12)',
              border: '1px dashed #2f7d31',
              fontSize: 12,
              color: '#2f7d31',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            ✓ ZERO-BASED. EVERY COIN NOW HAS A JOB.
          </div>
        )}
      </div>
      <div style={{ marginTop: 16, fontSize: 11, color: '#393939', display: 'flex', gap: 6 }}>
        <span style={{ fontWeight: 700, letterSpacing: 1 }}>TIP:</span>
        <span>
          Try spreading the {sym}
          {total.toLocaleString()} across the three rows until &quot;left to assign&quot; hits zero.
        </span>
      </div>
    </div>
  );
};
