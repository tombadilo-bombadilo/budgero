import { Trans, useLingui } from '@lingui/react/macro';
import { ExternalLink } from 'lucide-react';
import { useRef, useState } from 'react';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@shared/ui/drawer';
import { docsUrl, type PageGuideId } from '../model/page-guides';
import { usePageGuideCards } from './guide-content';

export type PageGuideCloseReason = 'completed' | 'skipped';

interface PageGuideDialogProps {
  id: PageGuideId;
  startCard: number;
  onClose: (reason: PageGuideCloseReason) => void;
}

/**
 * One guide, card by card: a bottom sheet on phones, a small dialog on
 * larger screens. Closing it any other way than Done (Skip, Escape, the
 * close button, a swipe or a tap outside) counts as skipped, unless the
 * last card was already showing.
 */
export function PageGuideDialog({ id, startCard, onClose }: PageGuideDialogProps) {
  const { t, i18n } = useLingui();
  const isMobile = useIsMobile();
  const cards = usePageGuideCards(id);
  const [index, setIndex] = useState(() => Math.min(Math.max(startCard, 0), cards.length - 1));
  const card = cards[index];
  const last = index === cards.length - 1;

  const primary = useRef<HTMLButtonElement>(null);
  // Start on Next rather than Skip, so Enter walks through the cards.
  const focusPrimary = (event: Event) => {
    event.preventDefault();
    primary.current?.focus();
  };

  const dismiss = () => onClose(last ? 'completed' : 'skipped');
  const onOpenChange = (open: boolean) => {
    if (!open) dismiss();
  };

  const step = index + 1;
  const total = cards.length;
  const stepLabel = t`Step ${step} of ${total}`;
  const progress = (
    <div className="flex items-center gap-1" aria-hidden>
      {cards.map((c, i) => (
        <span
          key={c.key}
          className={cn(
            'h-1.5 rounded-full',
            i === index ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
  const body = (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
      <span className="sr-only">{stepLabel}</span>
      {card.visual}
      <p>{card.body}</p>
      {card.docs && (
        <a
          href={docsUrl(card.docs, i18n.locale)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Trans>Read more in the docs</Trans>
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </div>
  );
  const buttons = (
    <div className="flex w-full items-center gap-2">
      {!last && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={dismiss}>
          <Trans>Skip</Trans>
        </Button>
      )}
      <div className="ml-auto flex gap-2">
        {index > 0 && (
          <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
            <Trans>Back</Trans>
          </Button>
        )}
        {/* One button for Next and Done, so focus stays on it. */}
        <Button
          ref={primary}
          size="sm"
          onClick={() => (last ? onClose('completed') : setIndex(index + 1))}
        >
          {last ? <Trans>Done</Trans> : <Trans>Next</Trans>}
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open onOpenChange={onOpenChange}>
        <DrawerContent data-page-guide data-testid="page-guide" onOpenAutoFocus={focusPrimary}>
          <DrawerHeader className="gap-1.5 px-4 pb-2 pt-3 text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            {progress}
            <DrawerTitle className="text-base">{card.title}</DrawerTitle>
          </DrawerHeader>
          <DrawerDescription asChild>
            <div className="px-4">{body}</div>
          </DrawerDescription>
          <DrawerFooter className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {buttons}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        data-page-guide
        data-testid="page-guide"
        className="gap-3 sm:max-w-md"
        onOpenAutoFocus={focusPrimary}
      >
        <DialogHeader className="gap-2 text-left">
          {progress}
          <DialogTitle>{card.title}</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>{body}</DialogDescription>
        <DialogFooter className="pt-1">{buttons}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
