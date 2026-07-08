import { cn } from '@shared/lib/utils';
import { Spinner } from '@shared/ui/spinner';

export interface CenteredLoaderProps {
  /** Optional caption rendered beneath the spinner. */
  label?: string;
  /** Wrapper classes controlling sizing/spacing (e.g. `py-12`, `flex-1 p-4`). */
  className?: string;
  /**
   * Spinner style:
   * - `spinner` (default): primary-colored CSS border spinner with an optional caption.
   * - `icon`: muted Loader2 icon (used by full-page guards).
   */
  variant?: 'spinner' | 'icon';
}

/**
 * A centered loading indicator with an optional caption.
 * Shared across account/transactions pages and settings guards so each site
 * renders an identical spinner while controlling its own wrapper spacing.
 */
export function CenteredLoader({ label, className, variant = 'spinner' }: CenteredLoaderProps) {
  if (variant === 'icon') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        {label && <p className="text-sm text-muted-foreground">{label}</p>}
      </div>
    </div>
  );
}
