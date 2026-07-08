/**
 * Add Category Button
 *
 * The group-row "+" button that opens the add-category flow. Owns the
 * onboarding highlight-store wiring (pulse the button, clear on click);
 * trigger styling differs per layout and comes in via className props.
 */

import type { MouseEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { useUiStore } from '@shared/store/useUiStore';

export interface AddCategoryButtonProps {
  groupId: number;
  onAddCategory: (groupId: number) => void;
  /** Base trigger classes — layout-specific. */
  className?: string;
  /** Classes appended while the onboarding highlight targets this group. */
  highlightClassName?: string;
  iconClassName?: string;
  title?: string;
  /** Render a bare <button> instead of the ghost icon Button. */
  unstyled?: boolean;
}

export function AddCategoryButton({
  groupId,
  onAddCategory,
  className,
  highlightClassName,
  iconClassName = 'h-3.5 w-3.5',
  title,
  unstyled = false,
}: AddCategoryButtonProps) {
  const highlightAddGroupId = useUiStore((state) => state.highlightAddCategoryGroupId);
  const setHighlightAddGroupId = useUiStore((state) => state.setHighlightAddCategoryGroupId);
  const shouldHighlight = highlightAddGroupId !== null && Number(highlightAddGroupId) === groupId;

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (shouldHighlight) {
      setHighlightAddGroupId(null);
    }
    onAddCategory(groupId);
  };

  const classes = cn(className, shouldHighlight && highlightClassName);

  if (unstyled) {
    return (
      <button onClick={handleClick} className={classes}>
        <Plus className={iconClassName} />
      </button>
    );
  }

  return (
    <Button onClick={handleClick} variant="ghost" size="icon" className={classes} title={title}>
      <Plus className={iconClassName} />
    </Button>
  );
}
