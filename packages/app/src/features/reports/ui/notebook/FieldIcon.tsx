import { Calendar, CheckSquare, Hash, Tag, Type } from 'lucide-react';
import type { FieldType } from '@features/reports/lib/question';
import { cn } from '@shared/lib/utils';

const ICONS = {
  date: Calendar,
  number: Hash,
  text: Type,
  boolean: CheckSquare,
  entity: Tag,
} as const;

/** Small type glyph shown next to field names in pickers. */
export function FieldIcon({ type, className }: { type: FieldType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon aria-hidden className={cn('h-4 w-4 text-muted-foreground', className)} />;
}
