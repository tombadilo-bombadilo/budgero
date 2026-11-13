import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { Title, getCurrencySym, type StepProps } from './shared';

interface DoneStepExtraProps {
  applyState: 'idle' | 'running' | 'error';
  applyError?: string | null;
  /**
   * Leaving the demo: the master password was set when the demo was made,
   * and the demo is deleted once the real budget exists.
   */
  fromDemo?: boolean;
  /** Joining someone else's workspace (invite link or typed code). */
  joining?: boolean;
}

export const DoneStep: React.FC<Omit<StepProps, 'set'> & DoneStepExtraProps> = ({
  cur,
  state,
  applyState,
  applyError,
  fromDemo = false,
  joining = false,
}) => {
  const { t } = useLingui();

  const sym = getCurrencySym(state.currency);
  const accountCount = state.accounts.length;
  const categoryCount = state.selectedCats.length;
  const currencyRow: [string, string] = [t`Currency`, `${state.currency} (${sym})`];
  // Leaving the demo keeps the password set back then; what changes is that
  // the demo goes, which nobody should find out by surprise.
  const securityRows: [string, string][] = fromDemo
    ? [[t`Demo budget`, t`Deleted when you open yours`]]
    : [[t`Security`, state.password ? t`✓ Master password set` : t`— not set`]];
  const rows: [string, string][] =
    state.startMode === 'ynab'
      ? [
          [t`Source`, t`↓ Imported from YNAB`],
          [t`Budget`, state.budgetName || t`My budget`],
          currencyRow,
          ...securityRows,
        ]
      : [
          currencyRow,
          [t`Accounts`, plural(accountCount, { one: '# added', other: '# added' })],
          [t`Envelopes`, plural(categoryCount, { one: '# category', other: '# categories' })],
          ...securityRows,
        ];

  // Summary of choices shown on the Done screen (fresh/ynab paths only).
  const summaryCard = (
    <div className="rounded-lg border bg-card p-3 md:p-4">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground">
        <Trans>YOUR BUDGET SUMMARY</Trans>
      </div>
      <dl className="divide-y text-sm">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex justify-between gap-3 py-1.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div>
      {joining ? (
        <>
          <Title
            h={msg`Ready to join.`}
            sub={msg`Click below and we’ll redeem the invite, decrypt the shared workspace key on this device, and drop you into the budget.`}
          />
          {state.inviteSpaceName && (
            <div className="rounded-lg border bg-card px-3 py-2 text-sm md:px-4">
              <span className="text-muted-foreground">
                <Trans>Workspace</Trans>
              </span>{' '}
              <span className="font-medium">{state.inviteSpaceName}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <Title h={cur.title} sub={cur.subtitle} />
          {summaryCard}
        </>
      )}

      {applyState === 'running' && (
        <div className="mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs">
          <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-primary" />
          {joining
            ? t`Decrypting shared workspace key and joining…`
            : t`Encrypting your ledger and creating accounts…`}
        </div>
      )}
      {applyState === 'error' && applyError && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive"
        >
          <div className="mb-0.5 font-semibold">
            <Trans>Setup failed</Trans>
          </div>
          {applyError}
        </div>
      )}
    </div>
  );
};
