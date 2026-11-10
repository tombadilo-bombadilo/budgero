import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { cn } from '@shared/lib/utils';

/** Items shown before "+N more" (the legend never pushes the chart off a phone screen). */
const COLLAPSED_ITEMS = 8;

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
  const [expanded, setExpanded] = useState(false);
  const collapsible = items.length > COLLAPSED_ITEMS + 1;
  const collapsed = collapsible && !expanded;
  const more = items.length - COLLAPSED_ITEMS;
  return (
    <ul data-chart-legend className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label={t`Legend`}>
      {items.map((item, index) => {
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
          // data-legend-*: the PNG export redraws the legend from these.
          // Folded items stay in the DOM (hidden) so the PNG export still lists them.
          <li
            key={item.id}
            hidden={collapsed && index >= COLLAPSED_ITEMS}
            data-legend-color={item.color}
            data-legend-label={item.label}
            data-legend-off={off || undefined}
          >
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
      {collapsible && (
        <li data-no-export>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="rounded px-1 py-0.5 text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? t`Show less` : t`+${more} more`}
          </button>
        </li>
      )}
    </ul>
  );
}
