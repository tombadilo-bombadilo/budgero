import type { ReactNode } from 'react';
import { Label } from '@shared/ui/label';
import { HelpTooltip } from '@shared/ui/HelpTooltip';
import { cn } from '@shared/lib/utils';

interface FieldProps {
  /** Label text/content. */
  label: ReactNode;
  /** Wires the label to the control via `htmlFor`/`id`. Omit for controls (e.g. Select) that don't bind to a label id. */
  htmlFor?: string;
  /** Muted helper text rendered below the control. */
  hint?: ReactNode;
  /** Tooltip content rendered next to the label via `HelpTooltip`. */
  help?: ReactNode;
  /** Overrides the wrapper's default `space-y-1.5` (e.g. a tighter/looser variant). */
  className?: string;
  /** The form control. */
  children: ReactNode;
}

/**
 * The label-hint-control stack repeated across forms: a wrapper div, a
 * `Label` (optionally with a `HelpTooltip`), the control, and an optional
 * muted hint line below it.
 *
 * Adopt only at exact-shape sites — skip anything with custom label styling,
 * multiple controls, or a control+label arranged in a row (e.g. a Switch
 * toggle beside its label).
 */
export function Field({ label, htmlFor, hint, help, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor}>{label}</Label>
        {help && <HelpTooltip>{help}</HelpTooltip>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
