import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { StepHeroImage, Title, getCurrencySym, type StepProps } from './shared';

interface DoneStepExtraProps {
  applyState: 'idle' | 'running' | 'error';
  applyError?: string | null;
}

export const DoneStep: React.FC<Omit<StepProps, 'set'> & DoneStepExtraProps> = ({
  cur,
  state,
  applyState,
  applyError,
}) => {
  const { t } = useLingui();

  const sym = getCurrencySym(state.currency);
  const rows =
    state.startMode === 'ynab'
      ? [
          ['Source', '↓ Imported from YNAB'] as const,
          ['Budget', state.budgetName || 'My budget'] as const,
          ['Currency', `${state.currency} (${sym})`] as const,
          ['Security', state.password ? '✓ Master password set' : '— not set'] as const,
        ]
      : [
          ['Currency', `${state.currency} (${sym})`] as const,
          ['Accounts', `${state.accounts.length} added`] as const,
          ['Envelopes', `${state.selectedCats.length} categories`] as const,
          ['Security', state.password ? '✓ Master password set' : '— not set'] as const,
        ];

  // Summary of choices shown on the Done screen (fresh/ynab paths only).
  const summaryCard = (
    <div
      style={{
        marginTop: 16,
        padding: 20,
        border: '1px dashed rgba(57,57,57,0.5)',
        background: '#fbf7eb',
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 1.2,
          fontWeight: 700,
          color: '#393939',
          marginBottom: 12,
        }}
      >
        <Trans>YOUR BUDGET SUMMARY</Trans>
      </div>
      <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
        {rows.map(([k, v], i, arr) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              paddingBottom: 6,
              borderBottom: i < arr.length - 1 ? '1px dotted rgba(57,57,57,0.2)' : 'none',
            }}
          >
            <span style={{ color: '#393939' }}>{typeof k === 'string' ? k : t(k)}</span>
            <span style={{ fontWeight: 600 }}>{typeof v === 'string' ? v : t(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <StepHeroImage
        src="/onboarding-final.png"
        alt={t`Coin character holding a Your Budget Is Ready clipboard`}
      />
      {state.joinSecret ? (
        <Title
          h={msg`Ready to join.`}
          sub={msg`Click below and we’ll redeem the invite, decrypt the shared workspace key on this device, and drop you into the budget.`}
        />
      ) : (
        <>
          <Title h={cur.title} sub={cur.subtitle} />
          {summaryCard}
        </>
      )}

      {applyState === 'running' && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: '1px dashed #141414',
            background: '#fffdf8',
            fontSize: 12,
            color: '#141414',
            letterSpacing: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              background: '#c6392c',
              borderRadius: '50%',
              animation: 'budgero-onboarding-pulse 1.2s ease-in-out infinite',
            }}
          />
          {state.joinSecret
            ? t`Decrypting shared workspace key and joining…`
            : t`Encrypting your ledger and creating accounts…`}
        </div>
      )}
      {applyState === 'error' && applyError && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: '1px solid #c6392c',
            background: 'rgba(198,57,44,0.08)',
            fontSize: 12,
            color: '#c6392c',
            letterSpacing: 0.3,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            <Trans>Setup failed</Trans>
          </div>
          {applyError}
        </div>
      )}
    </div>
  );
};
