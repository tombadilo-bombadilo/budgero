import React, { useState, memo, useRef, useCallback, useEffect } from 'react';
import { useSwipeable } from 'react-swipeable';
import { Trash2, Tag } from 'lucide-react';
import { cn } from '@shared/lib/utils';

/** Pixels of horizontal travel needed to execute an action on release. */
const SWIPE_TRIGGER_THRESHOLD = 96;
/** Pixels of travel before the row "locks" into a horizontal drag. */
const SWIPE_START_TRACKING_THRESHOLD = 18;
/** Maximum translate applied to the foreground row. */
const SWIPE_MAX_TRANSLATE = 120;

export interface SwipeRowAction {
  /** Icon rendered inside the action pill. */
  icon: React.ReactNode;
  /** Pill label once the swipe passed the trigger threshold. */
  label: string;
  /** Pill label while the swipe is still short of the trigger threshold. */
  hintLabel: string;
  /** CSS background of the reveal tint behind the row. */
  tintGradient: string;
  /** Color classes for the pill (border + background). */
  pillClassName: string;
}

/** Default left action (revealed by swiping right): reassign category. */
const SWIPE_REASSIGN_ACTION: SwipeRowAction = {
  icon: <Tag className="h-3.5 w-3.5" />,
  label: 'Reassign',
  hintLabel: 'Move',
  tintGradient:
    'linear-gradient(90deg, hsl(208 92% 44% / 0.36) 0%, hsl(208 92% 44% / 0.22) 62%, transparent 100%)',
  pillClassName: 'border-sky-100/55 bg-sky-600/95',
};

/** Default right action (revealed by swiping left): delete. */
const SWIPE_DELETE_ACTION: SwipeRowAction = {
  icon: <Trash2 className="h-3.5 w-3.5" />,
  label: 'Delete',
  hintLabel: 'Remove',
  tintGradient:
    'linear-gradient(270deg, hsl(0 78% 44% / 0.4) 0%, hsl(0 78% 44% / 0.24) 62%, transparent 100%)',
  pillClassName: 'border-red-100/55 bg-red-600/95',
};

export interface SwipeRowProps {
  children: React.ReactNode;
  /** Fired when the row is swiped right past the threshold (left action revealed). */
  onLeftAction?: () => void;
  /** Fired when the row is swiped left past the threshold (right action revealed). */
  onRightAction?: () => void;
  /**
   * Row-level click handler, invoked in the bubble phase so interactive
   * children run their own handlers first. Suppressed briefly after a swipe.
   */
  onClick?: () => void;
  /**
   * When true, post-swipe click suppression also runs in the capture phase so
   * ghost clicks never reach interactive children. Use for rows whose content
   * has its own click handlers (e.g. expandable transaction cards).
   */
  captureClicks?: boolean;
  /** Ignore mostly-vertical gestures to prevent row flicker while scrolling. */
  ignoreVerticalSwipes?: boolean;
  /**
   * When true the foreground keeps its transform/transition at rest, so a
   * released swipe slides back over 150ms. When false the row snaps back
   * instantly and idle rows carry no transform (no containing block).
   */
  animatedSnapBack?: boolean;
  /** Visuals for the left action pill/tint. Defaults to "Reassign". */
  leftAction?: SwipeRowAction;
  /** Visuals for the right action pill/tint. Defaults to "Delete". */
  rightAction?: SwipeRowAction;
}

/** Gmail-like swipeable row: swipe right/left to reveal and trigger actions. */
export const SwipeRow = memo(function SwipeRow({
  children,
  onLeftAction,
  onRightAction,
  onClick,
  captureClicks = false,
  ignoreVerticalSwipes = false,
  animatedSnapBack = false,
  leftAction = SWIPE_REASSIGN_ACTION,
  rightAction = SWIPE_DELETE_ACTION,
}: SwipeRowProps) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dxRef = useRef(0);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const suppressClickUntilRef = useRef(0);

  const flushDx = useCallback(() => {
    rafRef.current = null;
    setDx(dxRef.current);
  }, []);

  const scheduleDxFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(flushDx);
  }, [flushDx]);

  const resetSwipeState = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    dxRef.current = 0;
    draggingRef.current = false;
    setDx(0);
    setDragging(false);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handlers = useSwipeable({
    onSwiping: (event) => {
      if (event.dir !== 'Left' && event.dir !== 'Right') return;

      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      // Ignore mostly-vertical gestures to prevent row flicker while scrolling.
      if (ignoreVerticalSwipes && absY > absX * 1.1) return;

      if (!draggingRef.current) {
        if (absX < SWIPE_START_TRACKING_THRESHOLD) return;
        draggingRef.current = true;
        setDragging(true);
      }

      suppressClickUntilRef.current = Date.now() + 150;
      dxRef.current = event.deltaX;
      scheduleDxFlush();
    },
    onSwiped: () => {
      const finalDx = dxRef.current;
      if (Math.abs(finalDx) >= SWIPE_TRIGGER_THRESHOLD) {
        if (finalDx > 0) {
          onLeftAction?.();
        } else {
          onRightAction?.();
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(10);
        }
      }

      suppressClickUntilRef.current = Date.now() + 150;
      resetSwipeState();
    },
    onSwipedLeft: () => {
      suppressClickUntilRef.current = Date.now() + 150;
    },
    onSwipedRight: () => {
      suppressClickUntilRef.current = Date.now() + 150;
    },
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: false,
    delta: SWIPE_START_TRACKING_THRESHOLD,
  });

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (Date.now() <= suppressClickUntilRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick?.();
    },
    [onClick]
  );

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() <= suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const translate = Math.max(-SWIPE_MAX_TRANSLATE, Math.min(SWIPE_MAX_TRANSLATE, dx));
  const shouldApplyTransform = dragging || translate !== 0;
  const revealLeft = translate > 0 ? Math.min(1, translate / SWIPE_TRIGGER_THRESHOLD) : 0;
  const revealRight = translate < 0 ? Math.min(1, -translate / SWIPE_TRIGGER_THRESHOLD) : 0;
  const bgVisible = Math.abs(translate) > 2 || dragging;
  const leftLabelVisible = revealLeft > 0.45;
  const rightLabelVisible = revealRight > 0.45;

  const foregroundStyle: React.CSSProperties = animatedSnapBack
    ? {
        transform: `translateX(${translate}px)`,
        transition: dragging ? 'none' : 'transform 150ms ease',
      }
    : {
        transform: shouldApplyTransform ? `translateX(${translate}px)` : undefined,
        transition: shouldApplyTransform ? (dragging ? 'none' : 'transform 150ms ease') : undefined,
      };

  return (
    // Presentation wrapper: swipe-gesture plumbing and ghost-click
    // suppression around the row content, which carries the real controls.
    <div
      role="presentation"
      className="relative"
      {...handlers}
      style={{ touchAction: 'pan-y' }}
      onClick={handleClick}
      onClickCapture={captureClicks ? handleClickCapture : undefined}
    >
      {/* Background actions */}
      {bgVisible && (
        <div className="absolute inset-0 pointer-events-none" style={{ opacity: 1 }}>
          {/* Left tint */}
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${Math.max(0, translate)}px`,
              background: leftAction.tintGradient,
            }}
          />
          {/* Right tint */}
          <div
            className="absolute inset-y-0 right-0"
            style={{
              width: `${Math.max(0, -translate)}px`,
              background: rightAction.tintGradient,
            }}
          />
          {revealLeft > 0 && (
            <div
              className="absolute inset-y-0 left-3 flex items-center"
              style={{
                opacity: Math.max(0.35, revealLeft),
                transform: `translateX(${Math.max(0, 10 - revealLeft * 14)}px)`,
                transition: 'opacity 120ms ease, transform 120ms ease',
              }}
            >
              <div
                className={cn(
                  'flex items-center gap-2 rounded-full border text-white shadow-sm px-2.5 py-1',
                  leftAction.pillClassName
                )}
              >
                <span className="inline-flex items-center justify-center rounded-full bg-white/25 p-1">
                  {leftAction.icon}
                </span>
                <span className="text-[11px] font-semibold tracking-wide uppercase">
                  {leftLabelVisible ? leftAction.label : leftAction.hintLabel}
                </span>
              </div>
            </div>
          )}
          {revealRight > 0 && (
            <div
              className="absolute inset-y-0 right-3 flex items-center"
              style={{
                opacity: Math.max(0.35, revealRight),
                transform: `translateX(-${Math.max(0, 10 - revealRight * 14)}px)`,
                transition: 'opacity 120ms ease, transform 120ms ease',
              }}
            >
              <div
                className={cn(
                  'flex items-center gap-2 rounded-full border text-white shadow-sm px-2.5 py-1',
                  rightAction.pillClassName
                )}
              >
                <span className="text-[11px] font-semibold tracking-wide uppercase">
                  {rightLabelVisible ? rightAction.label : rightAction.hintLabel}
                </span>
                <span className="inline-flex items-center justify-center rounded-full bg-white/25 p-1">
                  {rightAction.icon}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Foreground content */}
      <div className="relative z-10" style={foregroundStyle}>
        {children}
      </div>
    </div>
  );
});
