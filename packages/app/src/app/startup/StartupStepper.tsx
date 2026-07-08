import { CheckCircle, ShieldCheck, FolderPlus, Wallet } from 'lucide-react';
import { cn } from '@shared/lib/utils';

const STEPS = [
  { label: 'Security', icon: ShieldCheck },
  { label: 'Workspace', icon: FolderPlus },
  { label: 'Budget', icon: Wallet },
] as const;

interface StartupStepperProps {
  currentStep: number;
}

export function StartupStepper({ currentStep }: StartupStepperProps) {
  return (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map((step, index) => {
        const stepNumber = index + 1;
        const isCompleted = stepNumber < currentStep;
        const isActive = stepNumber === currentStep;
        const Icon = step.icon;

        return (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors',
                  isCompleted && 'border-emerald-500 bg-emerald-500/10',
                  isActive && 'border-primary bg-primary/10',
                  !isCompleted && !isActive && 'border-muted-foreground/30 bg-muted/30'
                )}
              >
                {isCompleted ? (
                  <CheckCircle className="h-4.5 w-4.5 text-emerald-500" />
                ) : (
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      isActive ? 'text-primary' : 'text-muted-foreground/50'
                    )}
                  />
                )}
              </div>
              <span
                className={cn(
                  'text-xs font-medium',
                  isCompleted && 'text-emerald-600 dark:text-emerald-400',
                  isActive && 'text-primary',
                  !isCompleted && !isActive && 'text-muted-foreground/50'
                )}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  'mx-3 mb-5 h-0.5 w-10 sm:w-16 rounded-full transition-colors',
                  stepNumber < currentStep ? 'bg-emerald-500/50' : 'bg-muted-foreground/20'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
