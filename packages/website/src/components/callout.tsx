import { cn } from '@/lib/utils';
import { AlertTriangle, Info, Lightbulb } from 'lucide-react';

type Variant = 'info' | 'warning' | 'note';

export function Callout({
  children,
  variant = 'info',
  title,
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  title?: string;
  className?: string;
}) {
  const Icon = variant === 'warning' ? AlertTriangle : variant === 'note' ? Lightbulb : Info;
  const variantStyle =
    'border-gray-300/60 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100';

  return (
    <div className={cn('my-6 flex gap-3 rounded-md border p-4', variantStyle, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-1">
        {title ? <div className="font-medium leading-none">{title}</div> : null}
        <div className="text-sm leading-6 opacity-90">{children}</div>
      </div>
    </div>
  );
}
