import { useLingui } from '@lingui/react/macro';
import { Pin, PinOff } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { useSidebar } from '@shared/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { useUiStore } from '@shared/store/useUiStore';

/**
 * Pins the sidebar open on screens where it would otherwise slide out. Only
 * shown where pinning applies (see SIDEBAR_PIN_MIN_WIDTH); wider screens
 * always show the sidebar.
 */
export function SidebarPinToggle() {
  const { t } = useLingui();
  const { canPin, pinned } = useSidebar();
  const setSidebarPinned = useUiStore((state) => state.setSidebarPinned);

  if (!canPin) return null;

  const label = pinned ? t`Unpin the sidebar` : t`Keep the sidebar open`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={label}
          aria-pressed={pinned}
          data-testid="sidebar-pin-toggle"
          onClick={() => setSidebarPinned(!pinned)}
        >
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
