import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';

export interface FlowStatProps {
  /** Direction icon (e.g. ArrowUpRight / ArrowDownRight). */
  icon: LucideIcon;
  /** Stat label (e.g. "Inflow" / "Outflow"). */
  label: string;
  /** Pre-formatted value string — callers format with their own localizer. */
  value: string;
  /** Color theme applied to the icon and value. */
  color: 'success' | 'destructive';
  /** Text sizing: `sm` for mobile headers, `md` for desktop. */
  size?: 'sm' | 'md';
  /** When provided, the stat is wrapped in a help tooltip with this text. */
  tooltip?: string;
}

const COLOR_CLASS: Record<FlowStatProps['color'], string> = {
  success: 'text-success',
  destructive: 'text-destructive',
};

/**
 * An inflow/outflow stat block: a small direction icon + label above a
 * tabular-nums value. Shared by the account and all-transactions headers and
 * the account summary cards.
 */
export function FlowStat({ icon: Icon, label, value, color, size = 'md', tooltip }: FlowStatProps) {
  const colorClass = COLOR_CLASS[color];
  const labelSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const valueSize = size === 'sm' ? 'text-xs' : 'text-sm';

  const stat = (
    <>
      <div className="flex items-center gap-1">
        <Icon className={`w-3 h-3 ${colorClass}`} />
        <span className={`${labelSize} text-muted-foreground`}>{label}</span>
      </div>
      <p className={`${valueSize} font-semibold tabular-nums ${colorClass}`}>{value}</p>
    </>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{stat}</div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return <div>{stat}</div>;
}
