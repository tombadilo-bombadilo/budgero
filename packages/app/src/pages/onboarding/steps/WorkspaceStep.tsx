import React from 'react';
import { WORKSPACE_SUGGESTIONS } from '../onboarding-data';
import { InputRow, StepHeroImage, Title, type StepProps } from './shared';

export const WorkspaceStep: React.FC<StepProps> = ({ cur, state, set }) => (
  <div>
    <StepHeroImage
      src="/onboarding-workspace.png"
      alt="Coin character with a ledger and a budget nameplate"
    />
    <Title h={cur.title} sub={cur.subtitle} />
    <InputRow
      big
      value={state.budgetName}
      onChange={(v) => set({ budgetName: v })}
      placeholder="e.g. Household 2026"
    />
    <div style={{ marginTop: 16, fontSize: 11, color: '#393939', marginBottom: 8 }}>
      OR PICK ONE:
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {WORKSPACE_SUGGESTIONS.map((s) => (
        <button
          key={s}
          onClick={() => set({ budgetName: s })}
          style={{
            border: '1px dashed rgba(57,57,57,0.5)',
            background: state.budgetName === s ? '#141414' : 'transparent',
            color: state.budgetName === s ? '#fbf7eb' : '#141414',
            padding: '6px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          {s}
        </button>
      ))}
    </div>
  </div>
);
