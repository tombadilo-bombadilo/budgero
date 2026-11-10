import { Trans } from '@lingui/react/macro';
import { cn } from '@shared/lib/utils';
import { friendlyQueryError } from './query-error';

interface QueryErrorMessageProps {
  /** The raw error text (DuckDB / compiler). */
  error: string;
  className?: string;
}

/** A friendly explanation, with the technical message behind a "Details" disclosure. */
export function QueryErrorMessage({ error, className }: QueryErrorMessageProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <p>{friendlyQueryError(error)}</p>
      <details className="text-xs">
        <summary className="cursor-pointer select-none underline-offset-2 hover:underline">
          <Trans>Details</Trans>
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono">
          {error}
        </pre>
      </details>
    </div>
  );
}
