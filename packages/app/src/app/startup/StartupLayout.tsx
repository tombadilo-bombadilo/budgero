import { Trans, useLingui } from '@lingui/react/macro';
import type React from 'react';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { useLogout } from '@entities/user/api/useAuth';
import { StartupStepper } from './StartupStepper';

interface StartupLayoutProps {
  currentStep: number;
  children: React.ReactNode;
}

export function StartupLayout({ currentStep, children }: StartupLayoutProps) {
  const { t } = useLingui();

  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-8 sm:py-12">
      <div
        className={cn(
          'flex w-full flex-col items-center gap-8 transition-[max-width]',
          currentStep === 3 ? 'max-w-5xl lg:max-w-6xl xl:max-w-7xl' : 'max-w-xl'
        )}
      >
        <div className="flex flex-col items-center gap-1">
          <img className="h-10 w-10" src="/logo_128.png" alt={t`Budgero logo`} />
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            <Trans>Zero-based budgeting. Zero-knowledge privacy.</Trans>
          </p>
        </div>

        <StartupStepper currentStep={currentStep} />

        <div className="w-full">{children}</div>

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => logout.mutate()}
        >
          <Trans>Sign Out</Trans>
        </Button>
      </div>
    </div>
  );
}
