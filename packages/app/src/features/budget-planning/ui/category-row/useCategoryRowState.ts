import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { GoalCalculations, type CategoryFinancials, type Goal } from '@budgero/core/browser';
import { isInteractiveTarget, isMoveValid, isWithinSelectHandle } from './category-row.utils';

export interface UseCategoryRowStateParams {
  categoryId: number;
  available: MilliUnits;
  assigned: MilliUnits;
  activity: MilliUnits;
  goal: Goal | null;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  onLongPress?: (event: PointerEvent<HTMLDivElement>) => void;
  onPress?: (event: MouseEvent<HTMLDivElement>) => void;
  longPressDuration?: number;
}

export interface CategoryRowState {
  headerGoalProgressValue: number;
  headerGoalPercent: number;
  highlightAllocated: boolean;
  highlightGoalSection: boolean;
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
  moveAmount: MilliUnits;
  setMoveAmount: (amount: MilliUnits) => void;
  moveTarget: number | null;
  setMoveTarget: (target: number | null) => void;
  isEditingAllocated: boolean;
  setIsEditingAllocated: (editing: boolean) => void;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: () => void;
  handlePointerLeave: () => void;
  handlePointerCancel: () => void;
  handleClick: (event: MouseEvent<HTMLDivElement>) => void;
  // Move money popover open handler
  initMovePopover: () => void;
  // Confirms the pending move (validates, moves, then closes/resets)
  confirmMove: () => Promise<void>;
}

export function useCategoryRowState({
  categoryId,
  available,
  assigned,
  activity,
  goal,
  globalLocalizer,
  currentMonth,
  onMoveMoney,
  onLongPress,
  onPress,
  longPressDuration = 500,
}: UseCategoryRowStateParams): CategoryRowState {
  let headerGoalProgressValue = 0;
  let headerGoalPercent = 0;
  if (goal) {
    const currencyCode = globalLocalizer.resolvedOptions().currency;
    const finances: CategoryFinancials = {
      available,
      assigned,
      activity,
      currencyCode,
    };
    const computed = GoalCalculations.calculateProgress(goal, finances, currentMonth);
    headerGoalProgressValue = Math.min(100, Math.max(0, computed.percentage));
    headerGoalPercent = Math.round(computed.percentage);
  }

  const highlightAssignmentCategoryId = useUiStore((state) => state.highlightAssignmentCategoryId);
  const highlightAllocated = highlightAssignmentCategoryId === categoryId;
  const highlightGoalCategoryId = useUiStore((state) => state.highlightGoalCategoryId);
  const highlightGoalSection = !goal && highlightGoalCategoryId === categoryId;

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveAmount, setMoveAmount] = useState<MilliUnits>(ZERO_MILLI);
  const [moveTarget, setMoveTarget] = useState<number | null>(null);

  const [isEditingAllocated, setIsEditingAllocated] = useState(false);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onLongPress) return;
    if (event.pointerType === 'mouse') return;
    if (isInteractiveTarget(event.target)) return;
    if (!isWithinSelectHandle(event.target)) return;

    longPressTriggeredRef.current = false;
    clearLongPressTimer();
    event.persist?.();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      onLongPress?.(event);
    }, longPressDuration);
  };

  const handlePointerUp = () => {
    clearLongPressTimer();
  };

  const handlePointerLeave = () => {
    clearLongPressTimer();
  };

  const handlePointerCancel = () => {
    clearLongPressTimer();
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    clearLongPressTimer();
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    // Only trigger selection when the click originates from the category name header
    if (!isWithinSelectHandle(event.target)) return;
    if (isInteractiveTarget(event.target)) return;
    onPress?.(event);
  };

  const initMovePopover = () => {
    setMoveAmount(available > 0 ? available : ZERO_MILLI);
    setMoveTarget(null);
  };

  const confirmMove = async () => {
    if (!onMoveMoney || moveTarget === null) return;
    if (!isMoveValid(moveAmount, available, moveTarget)) return;
    const target: number | 'rta' = moveTarget === 0 ? 'rta' : moveTarget;
    await onMoveMoney(categoryId, moveAmount, target);
    setMoveOpen(false);
    setMoveAmount(ZERO_MILLI);
  };

  return {
    headerGoalProgressValue,
    headerGoalPercent,
    highlightAllocated,
    highlightGoalSection,
    moveOpen,
    setMoveOpen,
    moveAmount,
    setMoveAmount,
    moveTarget,
    setMoveTarget,
    isEditingAllocated,
    setIsEditingAllocated,
    handlePointerDown,
    handlePointerUp,
    handlePointerLeave,
    handlePointerCancel,
    handleClick,
    initMovePopover,
    confirmMove,
  };
}
