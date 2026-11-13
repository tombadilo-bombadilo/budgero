import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import React, { useId } from 'react';
import { Input } from '@shared/ui/input';
import { cn } from '@shared/lib/utils';
import { inviteProblemMessage } from '../invite-code';
import { FIELD_CLASS, FieldLabel, Title, type StepProps } from './shared';

/**
 * "Join with an invite code": the code (or the whole join link) someone sent.
 * The flow checks it on Next; a problem shows here until the code is edited.
 */
export const InviteCodeStep: React.FC<
  StepProps & { onSubmit: () => void; isChecking: boolean }
> = ({ state, set, onSubmit, isChecking }) => {
  const { t } = useLingui();
  const inputId = useId();
  const errorId = useId();
  const problem = state.inviteCodeProblem;

  return (
    <div>
      <Title
        h={msg`Enter your invite code`}
        sub={msg`Someone shared their Budgero budget with you. Paste the code or the whole link from their invite — you’ll join their budget instead of setting up your own.`}
      />
      <div data-keep-in-view>
        <FieldLabel htmlFor={inputId}>
          <Trans>INVITE CODE</Trans>
        </FieldLabel>
        <Input
          id={inputId}
          value={state.inviteCode}
          onChange={(e) => set({ inviteCode: e.target.value, inviteCodeProblem: null })}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            onSubmit();
          }}
          placeholder={t`paste the code or link here`}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          disabled={isChecking}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          className={cn(FIELD_CLASS, 'font-mono')}
        />
        {problem && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs leading-relaxed text-destructive">
            {inviteProblemMessage(problem)}
          </p>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        <Trans>
          The code stays on this device: Budgero only ever sees a fingerprint of it. Next, you pick
          a master password that keeps the shared budget encrypted here.
        </Trans>
      </p>
    </div>
  );
};
