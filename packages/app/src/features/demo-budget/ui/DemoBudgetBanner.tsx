import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router-dom';
import { track } from '@shared/lib/analytics/track';
import { useDemoSpaceId } from '@shared/lib/demo-space';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';

/** Shown on every page while the demo budget is the open workspace. */
export function DemoBudgetBanner() {
  const demoSpaceId = useDemoSpaceId();
  const activeSpaceId = useActiveSpaceId();
  if (!demoSpaceId || demoSpaceId !== activeSpaceId) return null;

  return (
    <div className="w-full bg-primary text-primary-foreground" data-testid="demo-banner">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <p className="min-w-0 flex-1 text-sm">
          <Trans>
            <strong>This is a demo budget</strong> with sample data. Click around, then make it
            yours.
          </Trans>
        </p>
        <Link
          to="/start-own-budget"
          onClick={() => track('demo_start_own_clicked')}
          className="shrink-0 rounded-md bg-primary-foreground px-3 py-1.5 text-sm font-semibold text-primary hover:opacity-90"
        >
          <Trans>Start my own budget</Trans>
        </Link>
      </div>
    </div>
  );
}
