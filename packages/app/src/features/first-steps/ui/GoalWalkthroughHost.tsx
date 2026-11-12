import { Trans, useLingui } from '@lingui/react/macro';
import { CalendarClock, Flag, Repeat, Wallet, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import type { GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import { calculateUnderfundedGoals } from '@features/budget-planning/ui/assign-dropdown/assign-dropdown.utils';
import { GoalKind, GuideProgress } from '@features/page-guides';
import { cn } from '@shared/lib/utils';
import { useUiStore } from '@shared/store/useUiStore';
import { Button } from '@shared/ui/button';
import {
  closeGoalWalkthrough,
  dispatchGoalWalkthrough,
  useGoalWalkthrough,
  type GoalWalkthroughState,
} from '../model/goal-walkthrough';
import { pointAtAssigned, useSelectedForWalkthrough } from '../model/walkthrough-page';

interface GoalWalkthroughHostProps {
  rows: GetMonthlyBudgetRow[];
  goals: Goal[];
  currentMonth: string;
  /** Formats a milliunit amount. */
  formatAmount: (milli: number) => string;
  /** 'bar': phone layout, the card sits at the bottom of the screen. */
  variant?: 'card' | 'bar';
}

const STEP_INDEX = { pick: 0, types: 1, create: 2, form: 2, saved: 3 } as const;
const CARD_WIDTH = 320;
const GAP = 12;

/** What the card points at, per step. */
function anchorSelector(state: GoalWalkthroughState): string | null {
  switch (state.step) {
    case 'pick':
      return '[data-budget-categories]';
    case 'create':
      return '[data-goal-create="highlighted"]';
    case 'types':
    case 'saved':
      return `[data-category-id="${state.categoryId}"]`;
    default:
      return null;
  }
}

/** The first match that is on screen (the same button can be in a row and the side panel). */
function visible(selector: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(selector)];
  return (
    all.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ??
    all[0] ??
    null
  );
}

/** Beside the anchor (right, else left), at its height, kept on screen. Null: no anchor. */
function placeBeside(anchor: HTMLElement | null): CSSProperties | null {
  const rect = anchor?.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // A wide anchor (the whole category list): over its right edge.
  let left =
    rect.right + GAP + CARD_WIDTH <= vw
      ? rect.right + GAP
      : rect.left - GAP - CARD_WIDTH >= 0
        ? rect.left - GAP - CARD_WIDTH
        : rect.right - CARD_WIDTH - GAP;
  left = Math.min(Math.max(GAP, left), vw - CARD_WIDTH - GAP);
  const top = Math.min(Math.max(GAP, rect.top), vh - 260);
  return { position: 'fixed', top, left, width: CARD_WIDTH };
}

/**
 * The first-steps goal walkthrough on the Budget page: one small card,
 * non-modal, beside what it talks about (at the bottom on a phone). The user
 * does every click themselves; the card follows their selection and the goal
 * form (see model/goal-walkthrough.ts).
 */
export function GoalWalkthroughHost({
  rows,
  goals,
  currentMonth,
  formatAmount,
  variant = 'card',
}: GoalWalkthroughHostProps) {
  const { t } = useLingui();
  const state = useGoalWalkthrough();
  const selected = useSelectedForWalkthrough(rows, goals);
  const open = state.step !== 'closed' && state.step !== 'form';

  // Follow the user's own selection.
  useEffect(() => {
    dispatchGoalWalkthrough({ type: 'select', selected });
  }, [selected]);

  // "Press Create Goal": highlight the button (and open the row on a phone).
  const createFor = state.step === 'create' ? state.categoryId : null;
  useEffect(() => {
    if (createFor === null) return;
    const ui = useUiStore.getState();
    ui.setHighlightGoalCategoryId(createFor);
    ui.setFocusCategoryId(createFor);
  }, [createFor]);

  // The category list is the thing to look at while picking.
  const picking = state.step === 'pick';
  useEffect(() => {
    if (!picking) return;
    const list = visible('[data-budget-categories]');
    list?.classList.add('ring-2', 'ring-primary/50', 'rounded-lg');
    return () => list?.classList.remove('ring-2', 'ring-primary/50', 'rounded-lg');
  }, [picking]);

  // Esc closes it, from anywhere on the page (the goal form handles its own).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeGoalWalkthrough();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Desktop: stay beside the anchor as the page scrolls.
  const selector = open && variant === 'card' ? anchorSelector(state) : null;
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!selector) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setStyle(placeBeside(visible(selector))));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [selector]);

  if (!open) return null;

  const strong = (text: string) => <strong className="text-foreground">{text}</strong>;
  let title: React.ReactNode;
  let body: React.ReactNode;
  let action: React.ReactNode = null;

  if (state.step === 'pick') {
    title = <Trans>Pick a category</Trans>;
    const taken = state.taken ? strong(state.taken) : null;
    body = taken ? (
      <Trans>{taken} already has a goal. Pick another one.</Trans>
    ) : variant === 'bar' ? (
      <Trans>Tap the category you want a goal for. Rent or groceries are a good first one.</Trans>
    ) : (
      <Trans>Pick the category you want a goal for. Rent or groceries are a good first one.</Trans>
    );
  } else if (state.step === 'types') {
    const name = state.categoryName;
    title = <Trans>A goal for {name}</Trans>;
    body = (
      <>
        <div className="grid gap-1.5" data-testid="goal-types">
          {/* The titles and icons of GoalForm's presets. */}
          <GoalKind
            icon={Wallet}
            label={t`Monthly Available Target`}
            description={t`Every month: have an amount ready, like rent or groceries.`}
          />
          <GoalKind
            icon={CalendarClock}
            label={t`Yearly Allocation Target`}
            description={t`By a date: save a total by a day, like a holiday.`}
          />
          <GoalKind
            icon={Repeat}
            label={t`Periodic Allocation Target`}
            description={t`Every few months: for bills that come quarterly or once a year.`}
          />
          <GoalKind
            icon={Flag}
            label={t`Target Balance`}
            description={t`Build up to: an amount with no date, like an emergency fund.`}
          />
        </div>
        <p>
          <Trans>You pick one in the goal form, and can change it later.</Trans>
        </p>
      </>
    );
    action = (
      <Button size="sm" onClick={() => dispatchGoalWalkthrough({ type: 'next' })}>
        <Trans>Next</Trans>
      </Button>
    );
  } else if (state.step === 'create') {
    const name = strong(state.categoryName);
    title = <Trans>Press Create Goal</Trans>;
    body =
      variant === 'bar' ? (
        <Trans>It’s in the {name} card, under its amounts.</Trans>
      ) : (
        <Trans>It’s next to {name}, highlighted.</Trans>
      );
  } else {
    // saved
    const goal = goals.find((g) => g.CategoryID === state.categoryId);
    const needed = goal
      ? (calculateUnderfundedGoals([goal], rows, 'USD', currentMonth)[0]?.needed ?? 0)
      : null;
    const name = strong(state.categoryName);
    const { categoryId } = state;
    title = <Trans>Goal set</Trans>;
    if (needed) {
      const amount = strong(formatAmount(needed));
      body = (
        <Trans>
          {name} needs {amount} this month, now fund it.
        </Trans>
      );
      action = (
        <Button
          size="sm"
          onClick={() => {
            closeGoalWalkthrough();
            pointAtAssigned(categoryId);
          }}
        >
          <Trans>Fund it</Trans>
        </Button>
      );
    } else {
      body =
        needed === 0 ? (
          <Trans>{name} has what it needs this month. Nice work.</Trans>
        ) : (
          <Trans>{name} has a goal now.</Trans>
        );
      action = (
        <Button size="sm" onClick={closeGoalWalkthrough}>
          <Trans>Done</Trans>
        </Button>
      );
    }
  }

  const index = STEP_INDEX[state.step];
  const step = index + 1;
  const total = 4;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="goal-walkthrough-title"
      data-testid="goal-walkthrough"
      data-step={state.step}
      style={variant === 'card' ? (style ?? undefined) : undefined}
      className={cn(
        // The page guide card: same surface, type and spacing.
        'z-40 grid gap-3 rounded-lg border bg-background/80 p-4 shadow-lg backdrop-blur-xl supports-[backdrop-filter]:bg-background/60',
        variant === 'bar'
          ? 'fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))]'
          : !style && 'fixed bottom-6 right-6 w-80'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-2">
          <GuideProgress count={total} index={index} />
          <h2 id="goal-walkthrough-title" className="text-base leading-none font-semibold">
            {title}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 -mt-2 h-7 w-7 shrink-0 text-muted-foreground"
          aria-label={t`Close`}
          onClick={closeGoalWalkthrough}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
        <span className="sr-only">{t`Step ${step} of ${total}`}</span>
        {body}
      </div>
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  );
}
