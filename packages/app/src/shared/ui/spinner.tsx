import { Loader2 } from 'lucide-react';
import { cn } from '@shared/lib/utils';

const SIZE_CLASSES = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE_CLASSES;
  /** Extra classes (color, margins, or size overrides). */
  className?: string;
}

/** Shared spinning loader icon (Loader2 + animate-spin). */
export function Spinner({ size = 'sm', className }: SpinnerProps) {
  return <Loader2 className={cn('animate-spin', SIZE_CLASSES[size], className)} />;
}
