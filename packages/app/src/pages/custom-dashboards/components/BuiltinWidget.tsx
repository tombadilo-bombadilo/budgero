import { useLingui } from '@lingui/react/macro';
import { useLayoutEffect, useRef } from 'react';
import { MoveHorizontal, Trash2 } from 'lucide-react';
import type { CustomDashboardWidget } from '@budgero/core/browser';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { BuiltinCard } from '@widgets/dashboard/builtin/BuiltinCard';
import { BUILTIN_CARDS, type BuiltinCardKey } from '@widgets/dashboard/builtin/builtin-cards';

/**
 * Height an element's content needs, even while it is stretched taller than
 * that: the bottom of its lowest in-flow child plus its bottom padding and
 * border (children of a stretched card stay at the top).
 */
function naturalHeight(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  let bottom =
    rect.top + parseFloat(style.paddingTop || '0') + parseFloat(style.borderTopWidth || '0');
  let inFlow = 0;
  for (const child of Array.from(element.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const childStyle = getComputedStyle(child);
    if (childStyle.position === 'absolute' || childStyle.position === 'fixed') continue;
    if (childStyle.display === 'none') continue;
    inFlow += 1;
    bottom = Math.max(
      bottom,
      child.getBoundingClientRect().bottom + parseFloat(childStyle.marginBottom || '0')
    );
  }
  if (inFlow === 0) return rect.height;
  return (
    bottom -
    rect.top +
    parseFloat(style.paddingBottom || '0') +
    parseFloat(style.borderBottomWidth || '0')
  );
}

const BAR_GAP_PX = 8;

/** Height a built-in frame needs: its edit bar (if any) plus the card's content. */
function frameNaturalHeight(frame: HTMLElement): number {
  const holder = frame.querySelector<HTMLElement>(':scope > [data-builtin-card]');
  const card = holder?.firstElementChild;
  const bar = holder?.previousElementSibling;
  const cardHeight = card instanceof HTMLElement ? naturalHeight(card) : 0;
  const barHeight = bar instanceof HTMLElement ? bar.offsetHeight + BAR_GAP_PX : 0;
  return barHeight + cardHeight;
}

/** Reports the natural height of a built-in frame whenever it or its card's content resizes. */
function useNaturalHeight(
  ref: React.RefObject<HTMLElement | null>,
  onHeight: ((px: number) => void) | undefined
) {
  const onHeightRef = useRef(onHeight);
  useLayoutEffect(() => {
    onHeightRef.current = onHeight;
  });
  const enabled = Boolean(onHeight);

  useLayoutEffect(() => {
    const frameElement = ref.current;
    if (!frameElement || !enabled || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        onHeightRef.current?.(Math.ceil(frameNaturalHeight(frameElement)))
      );
    };
    const resizeObserver = new ResizeObserver(report);
    const mutationObserver = new MutationObserver(() => {
      observeTree();
      report();
    });
    function observeTree() {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      const holder = frameElement!.querySelector(':scope > [data-builtin-card]');
      const card = holder?.firstElementChild;
      for (const node of [frameElement!, ...Array.from(frameElement!.children)]) {
        resizeObserver.observe(node);
      }
      if (card) {
        resizeObserver.observe(card);
        for (const child of Array.from(card.children)) resizeObserver.observe(child);
        mutationObserver.observe(card, { childList: true });
      }
      if (holder) mutationObserver.observe(holder, { childList: true });
      mutationObserver.observe(frameElement!, { childList: true });
    }
    observeTree();
    report();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [ref, enabled]);
}

interface BuiltinWidgetProps {
  widget: CustomDashboardWidget;
  cardKey: BuiltinCardKey | 'unknown';
  isEditMode: boolean;
  isMobile: boolean;
  onRemove: (widgetId: string) => Promise<void>;
  onUpdateDesktopLayout: (
    widgetId: string,
    patch: Partial<{ colSpan: number; rowSpan: number }>
  ) => Promise<void>;
  /** Desktop grid: the height the card needs, to size its grid area. */
  onHeight?: (widgetId: string, px: number) => void;
}

/**
 * A built-in card on a dashboard grid. It sizes to its content (no row
 * span), fills the height its row gives it, and in edit mode gets a bar with
 * its name, width steppers (desktop) and remove.
 */
export function BuiltinWidget({
  widget,
  cardKey,
  isEditMode,
  isMobile,
  onRemove,
  onUpdateDesktopLayout,
  onHeight,
}: BuiltinWidgetProps) {
  const { t } = useLingui();
  const measureRef = useRef<HTMLDivElement | null>(null);
  useNaturalHeight(measureRef, onHeight && !isMobile ? (px) => onHeight(widget.id, px) : undefined);
  const name =
    cardKey === 'unknown' ? widget.titleOverride || t`Card` : t(BUILTIN_CARDS[cardKey].label);
  const { colSpan } = widget.desktopLayout;

  return (
    <div
      ref={measureRef}
      className={
        isMobile
          ? 'flex flex-col gap-2'
          : 'flex h-full flex-col gap-2 [&>[data-builtin-card]>[data-slot=card]]:h-full'
      }
    >
      {isEditMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/40 px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
          {!isMobile && (
            <>
              <Badge variant="outline">{t`Cols ${colSpan}`}</Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={colSpan <= 3}
                aria-label={t`Narrower: ${name}`}
                onClick={() =>
                  void onUpdateDesktopLayout(widget.id, { colSpan: Math.max(3, colSpan - 1) })
                }
              >
                <MoveHorizontal className="mr-1 h-3 w-3" aria-hidden />
                {t`Width -`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={colSpan >= 12}
                aria-label={t`Wider: ${name}`}
                onClick={() =>
                  void onUpdateDesktopLayout(widget.id, { colSpan: Math.min(12, colSpan + 1) })
                }
              >
                <MoveHorizontal className="mr-1 h-3 w-3" aria-hidden />
                {t`Width +`}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t`Remove ${name} from dashboard`}
            title={t`Remove from dashboard`}
            onClick={() => void onRemove(widget.id)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
      <div data-builtin-card className={isMobile ? undefined : 'min-h-0 flex-1'}>
        <BuiltinCard cardKey={cardKey} fallbackTitle={widget.titleOverride} />
      </div>
    </div>
  );
}
