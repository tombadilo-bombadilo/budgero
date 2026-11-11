import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import React from 'react';
import { Title, type StepProps } from './shared';

/**
 * First step of the invite path only (a new user who landed via
 * /join#code=…): they join someone else's workspace instead of building
 * their own, so this says what the next two screens do.
 */
export const WelcomeStep: React.FC<StepProps> = () => {
  const { t } = useLingui();

  return (
    <div>
      <Title
        h={msg`You’re joining a Budgero workspace.`}
        sub={msg`Someone shared their budget with you. We’ll set up an encryption key on this device, then drop you straight into their ledger — no setup of your own required.`}
      />
      <ol className="grid gap-2.5 text-sm text-muted-foreground">
        {[
          t`Pick a master password — your encryption key on this device.`,
          t`We’ll redeem the invite and unlock the shared workspace.`,
          t`You land on the dashboard with their budget ready to go.`,
        ].map((s, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold text-foreground">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <Trans>
          <span className="font-semibold text-foreground">
            <Trans>HEADS UP:</Trans>
          </span>{' '}
          Your master password encrypts the shared workspace key on this device. Pick something
          memorable — Budgero never sees it and we can’t reset it for you.
        </Trans>
      </div>
    </div>
  );
};
