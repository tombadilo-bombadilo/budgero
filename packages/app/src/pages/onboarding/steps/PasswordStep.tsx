import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import React, { useId } from 'react';
import { cn } from '@shared/lib/utils';
import { PasswordInput } from '@shared/ui/password-input';
import { FIELD_CLASS, FieldLabel, Title, type StepProps } from './shared';

export const PasswordStep: React.FC<StepProps & { forDemo?: boolean }> = ({
  state,
  set,
  forDemo = false,
}) => {
  const { t } = useLingui();

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
  const strengthLabel = [t`TOO SHORT`, t`WEAK`, t`OK`, t`GOOD`, t`STRONG`, t`IRON-CLAD`][strength];
  const strengthColor = ['#c6392c', '#c6392c', '#f97316', '#facc15', '#2f7d31', '#2f7d31'][
    strength
  ];
  const matches = pw.length > 0 && pw === state.passwordConfirm;
  const pwId = useId();
  const confirmId = useId();
  return (
    <div>
      <Title
        h={msg`Lock your ledger.`}
        sub={
          forDemo
            ? msg`Even the demo is encrypted on your device before anything is saved, so it needs a master password too. It’s the same one your own budget will use later. Pick something memorable — we can’t reset it for you.`
            : msg`Your budget lives on your device, encrypted with a master password only you know. Pick something memorable — we can’t reset it for you.`
        }
      />
      <div
        data-keep-in-view
        className="grid scroll-my-3 gap-3 group-data-[compact]/onb:gap-2 md:grid-cols-2 md:gap-4"
      >
        <div>
          <FieldLabel htmlFor={pwId}>
            <Trans>MASTER PASSWORD</Trans>
          </FieldLabel>
          <PasswordInput
            id={pwId}
            value={pw}
            onChange={(e) => set({ password: e.target.value })}
            enterKeyHint="next"
            onKeyDown={(e) => {
              // Enter (Next on a phone keyboard) moves on to the confirm field.
              if (e.key !== 'Enter') return;
              e.preventDefault();
              document.getElementById(confirmId)?.focus();
            }}
            placeholder={t`at least 8 characters`}
            autoComplete="new-password"
            className={FIELD_CLASS}
          />
          {pw.length > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex flex-1 gap-0.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="h-1 flex-1 rounded-full bg-muted"
                    style={i < strength ? { background: strengthColor } : undefined}
                  />
                ))}
              </div>
              <span
                className="text-[10px] font-semibold tracking-wider"
                style={{ color: strengthColor }}
              >
                {strengthLabel}
              </span>
            </div>
          )}
        </div>
        <div>
          <FieldLabel htmlFor={confirmId}>
            <Trans>CONFIRM PASSWORD</Trans>
          </FieldLabel>
          <PasswordInput
            id={confirmId}
            value={state.passwordConfirm}
            onChange={(e) => set({ passwordConfirm: e.target.value })}
            enterKeyHint="done"
            placeholder={t`type it once more`}
            autoComplete="new-password"
            className={FIELD_CLASS}
          />
          {state.passwordConfirm.length > 0 && (
            <div
              className={cn(
                'mt-1.5 text-[10px] font-semibold tracking-wider',
                matches ? 'text-emerald-600' : 'text-destructive'
              )}
            >
              {matches ? t`✓ MATCH` : t`✗ DOES NOT MATCH`}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <Trans>
          <span className="mr-1.5 font-semibold text-foreground">
            <Trans>⚠ READ THIS</Trans>
          </span>
          Your budget is encrypted with this password on your device. We never see it. If you forget
          it,{' '}
          <span className="font-semibold text-foreground">
            <Trans>your ledger is unrecoverable</Trans>
          </span>{' '}
          — there is no reset email, no support line, no backdoor.
        </Trans>
      </div>
    </div>
  );
};
