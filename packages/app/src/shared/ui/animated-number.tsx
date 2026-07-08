import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { useMotionValue, useSpring, useMotionValueEvent, useReducedMotion } from 'framer-motion';
import { cn } from '@shared/lib/utils';

export interface AnimatedNumberProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The target numeric value. When this changes, the displayed number animates toward it. */
  value: number;
  /** Formatter applied to the (possibly fractional) intermediate value each frame. */
  formatter: (value: number) => string;
  /**
   * Spring stiffness. Higher = snappier. Default tuned for amounts that change by hundreds/thousands.
   * See framer-motion spring docs.
   */
  stiffness?: number;
  /** Spring damping. Higher = less bounce. Default lands smoothly with no overshoot. */
  damping?: number;
  /**
   * Rounding mode applied before formatting each frame.
   * - "integer": `Math.round(latest)` — best for whole-unit currencies (RSD, JPY).
   * - "none": pass-through — best for currencies with cents (USD, EUR).
   * Defaults to "none" so cents animate smoothly.
   */
  rounding?: 'integer' | 'none';
}

/**
 * Animates a number between value changes using a spring.
 *
 * - Skips the initial mount (no count-up on first render).
 * - Respects `prefers-reduced-motion` by rendering instantly.
 * - Cheap enough for dozens of instances on a page (each spring is a single RAF loop).
 */
export function AnimatedNumber({
  value,
  formatter,
  className,
  stiffness = 180,
  damping = 26,
  rounding = 'none',
  ...rest
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion();

  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, { stiffness, damping });

  // Keep the raw animated number in state and format at render time, so
  // formatter changes (privacy mask toggle, locale switch) apply immediately
  // instead of waiting for the next value change.
  const [current, setCurrent] = useState(value);

  // On `value` change, push the new target to the motion value.
  // First render already matches — no animation on mount.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    if (reducedMotion) {
      // Snap both the source and the spring; the subscription below fires with
      // the new value and updates the display. No setState inside the effect.
      motionValue.jump(value);
      spring.jump(value);
      return;
    }
    motionValue.set(value);
  }, [value, motionValue, spring, reducedMotion]);

  useMotionValueEvent(spring, 'change', (latest) => {
    setCurrent(latest);
  });

  const rounded = rounding === 'integer' ? Math.round(current) : current;

  return (
    <span className={cn(className)} {...rest}>
      {formatter(rounded)}
    </span>
  );
}
