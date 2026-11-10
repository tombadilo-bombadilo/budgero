import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerTitle } from '@shared/ui/drawer';
import { Popover, PopoverContent } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';

/** Room kept free under popovers: the phone's bottom navigation bar. */
const BOTTOM_BAR_CLEARANCE = 80;

/** Solid overlay background (the app's glass look lets the page bleed through). */
export const SOLID_OVERLAY = 'bg-popover supports-[backdrop-filter]:bg-popover backdrop-blur-none';

interface PickerState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PickerContext = createContext<PickerState | null>(null);

/**
 * A picker that is a popover next to its trigger on wide screens and a
 * bottom sheet on phones. Use like Popover: PopoverTrigger / PopoverAnchor
 * inside, and PickerContent for the body.
 */
export function PickerRoot({
  open,
  onOpenChange,
  children,
}: PickerState & { children: ReactNode }) {
  return (
    <PickerContext.Provider value={{ open, onOpenChange }}>
      <Popover open={open} onOpenChange={onOpenChange}>
        {children}
      </Popover>
    </PickerContext.Provider>
  );
}

export function PickerContent({
  className,
  title,
  children,
  ...props
}: ComponentProps<typeof PopoverContent> & {
  /** Accessible name of the sheet on phones. */
  title: string;
}) {
  const isMobile = useIsMobile();
  const picker = useContext(PickerContext);
  if (isMobile && picker) {
    return (
      <Drawer open={picker.open} onOpenChange={picker.onOpenChange}>
        <DrawerContent className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <div className="min-h-0 overflow-y-auto pb-2">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <PopoverContent
      collisionPadding={{ top: 8, bottom: BOTTOM_BAR_CLEARANCE, left: 8, right: 8 }}
      className={cn(
        'max-h-(--radix-popover-content-available-height) overflow-y-auto',
        SOLID_OVERLAY,
        className
      )}
      {...props}
    >
      {children}
    </PopoverContent>
  );
}
