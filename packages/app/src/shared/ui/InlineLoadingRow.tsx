import { Spinner } from '@shared/ui/spinner';

/** In-card loading row: a small spinner + label, used inside table/list cards. */
export function InlineLoadingRow({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
      <Spinner /> {label}
    </div>
  );
}
