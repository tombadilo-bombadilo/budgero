import { Trans, useLingui } from '@lingui/react/macro';
import { CircleHelp } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { openPageGuide, pageGuideForPath } from '../model/page-guides';

interface PageGuideButtonProps {
  /** Icon only (phone top bar); the label shows from `lg` up otherwise. */
  iconOnly?: boolean;
  className?: string;
}

/** "How this works" for the current page; renders nothing on pages without a guide. */
export function PageGuideButton({ iconOnly = false, className }: PageGuideButtonProps) {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const id = pageGuideForPath(pathname);
  if (!id) return null;

  return (
    <Button
      variant="ghost"
      size={iconOnly ? 'icon' : 'sm'}
      className={cn('gap-1.5 text-muted-foreground', className)}
      onClick={() => openPageGuide(id)}
      title={t`How this works`}
      aria-label={t`How this works`}
      aria-haspopup="dialog"
      data-testid="page-guide-button"
    >
      <CircleHelp className="h-4 w-4" />
      {!iconOnly && (
        <span className="hidden lg:inline">
          <Trans>How this works</Trans>
        </span>
      )}
    </Button>
  );
}
