import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router-dom';
import { track } from '@shared/lib/analytics/track';
import { useIsDemoSpace } from '../lib/useIsDemoSpace';

/** Shown on every page while the demo budget is the open workspace. */
export function DemoBudgetBanner() {
  const isDemo = useIsDemoSpace();
  if (!isDemo) return null;

  return (
    <div className="w-full bg-primary text-primary-foreground" data-testid="demo-banner">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 sm:gap-3 sm:px-6 sm:py-2.5 lg:px-8">
        <p className="min-w-0 flex-1 text-xs leading-snug sm:text-sm">
          <strong>
            <Trans>Demo budget</Trans>
          </strong>
          <span className="hidden sm:inline">
            {' '}
            <Trans>with sample data. Click around, then make it yours.</Trans>
          </span>
          <span className="sm:hidden">
            {' '}
            <Trans>· sample data</Trans>
          </span>
        </p>
        <Link
          to="/start-own-budget"
          onClick={() => track('demo_start_own_clicked')}
          className="shrink-0 whitespace-nowrap rounded-md bg-primary-foreground px-2.5 py-1 text-xs font-semibold text-primary hover:opacity-90 sm:px-3 sm:py-1.5 sm:text-sm"
        >
          <Trans>Start my own budget</Trans>
        </Link>
      </div>
    </div>
  );
}
