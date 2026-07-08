import type React from 'react';
import { Button } from '@shared/ui/button';
import { useLogout } from '@entities/user/api/useAuth';
import { StartupStepper } from './StartupStepper';

interface StartupLayoutProps {
  currentStep: number;
  children: React.ReactNode;
}

export function StartupLayout({ currentStep, children }: StartupLayoutProps) {
  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-8 sm:py-12">
      <div className="flex w-full max-w-xl flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-1">
          <img className="h-10 w-10" src="/logo_128.png" alt="Budgero logo" />
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            Zero-based budgeting. Zero-knowledge privacy.
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
          Sign Out
        </Button>
      </div>
    </div>
  );
}
