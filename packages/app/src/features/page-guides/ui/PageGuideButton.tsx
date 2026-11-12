import { Trans, useLingui } from '@lingui/react/macro';
import { CircleHelp } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { openPageGuide, pageGuideForPath } from '../model/page-guides';

export interface PageGuideMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
}

interface PageGuideButtonProps {
  /** Icon only (phone top bar); the label shows from `lg` up otherwise. */
  iconOnly?: boolean;
  className?: string;
  /**
   * More help for this page (e.g. "Show first steps"). With any, the button
   * opens a small menu: "How this works" first, then these.
   */
  extraItems?: PageGuideMenuItem[];
}

/** "How this works" for the current page; renders nothing on pages without a guide. */
export function PageGuideButton({ iconOnly = false, className, extraItems }: PageGuideButtonProps) {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const id = pageGuideForPath(pathname);
  if (!id) return null;

  const label = t`How this works`;
  const content = (
    <>
      <CircleHelp className="h-4 w-4" />
      {!iconOnly && (
        <span className="hidden lg:inline">
          <Trans>How this works</Trans>
        </span>
      )}
    </>
  );
  const buttonProps = {
    variant: 'ghost' as const,
    size: iconOnly ? ('icon' as const) : ('sm' as const),
    className: cn('gap-1.5 text-muted-foreground', className),
    title: label,
    'aria-label': label,
    'data-testid': 'page-guide-button',
  };

  if (extraItems?.length) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button {...buttonProps}>{content}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => openPageGuide(id)}>{label}</DropdownMenuItem>
          {extraItems.map((item) => (
            <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button {...buttonProps} aria-haspopup="dialog" onClick={() => openPageGuide(id)}>
      {content}
    </Button>
  );
}
