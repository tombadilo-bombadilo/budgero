import { cn } from '@shared/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('bg-accent rounded-md', className)} {...props} />;
}

export { Skeleton };
