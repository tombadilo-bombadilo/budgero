import { useLingui } from '@lingui/react/macro';
import { cn } from '@shared/lib/utils';

export interface LegendItem {
  id: string;
  label: string;
  color: string;
}

interface ChartLegendProps {
  items: LegendItem[];
  hidden?: Set<string>;
  /** Omit for a static (non-toggling) legend. */
  onToggle?: (id: string) => void;
}

/** Wrapping legend above a chart; items toggle their series when `onToggle` is set. */
export function ChartLegend({ items, hidden, onToggle }: ChartLegendProps) {
  const { t } = useLingui();
  return (
    <ul
      className="flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-xs"
      aria-label={t`Legend`}
    >
      {items.map((item) => {
        const off = hidden?.has(item.id) ?? false;
        const swatch = (
          <>
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <span className="max-w-48 truncate">{item.label}</span>
          </>
        );
        return (
          <li key={item.id}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={!off}
                onClick={() => onToggle(item.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  off && 'text-muted-foreground line-through opacity-60'
                )}
              >
                {swatch}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-1 py-0.5">{swatch}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
