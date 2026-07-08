import { Skeleton } from '@shared/ui/skeleton';

type BudgetTableSkeletonProps = {
  layoutVariant?: 'default' | 'desktop-compact' | 'desktop-table' | 'cards' | 'compact' | 'table';
};

const CARD_ROWS = Array.from({ length: 2 });
const TABLE_ROWS = Array.from({ length: 2 });

export function BudgetTableSkeleton({ layoutVariant = 'default' }: BudgetTableSkeletonProps) {
  const variant = normalizeVariant(layoutVariant);

  if (variant === 'table') {
    return (
      <div className="space-y-2 px-4 py-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-md" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] bg-muted px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16 justify-self-end" />
            <Skeleton className="h-4 w-16 justify-self-end" />
            <Skeleton className="h-4 w-16 justify-self-end" />
          </div>
          <div className="divide-y divide-border/50">
            {TABLE_ROWS.map((_, index) => (
              <div
                key={index}
                className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center px-4 py-4"
              >
                <div className="space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-16 justify-self-end" />
                <Skeleton className="h-4 w-16 justify-self-end" />
                <Skeleton className="h-4 w-16 justify-self-end" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="space-y-3 px-4 py-6">
        {CARD_ROWS.map((_, index) => (
          <div key={index} className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(72px,96px))] items-center gap-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-16 justify-self-end" />
              <Skeleton className="h-4 w-16 justify-self-end" />
              <Skeleton className="h-4 w-16 justify-self-end" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // cards layout (default)
  return (
    <div className="space-y-3 px-4 py-6">
      {CARD_ROWS.map((_, index) => (
        <div key={index} className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-5 w-12" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeVariant(
  variant: BudgetTableSkeletonProps['layoutVariant']
): 'cards' | 'compact' | 'table' {
  switch (variant) {
    case 'desktop-table':
    case 'table':
      return 'table';
    case 'desktop-compact':
    case 'compact':
      return 'compact';
    default:
      return 'cards';
  }
}
