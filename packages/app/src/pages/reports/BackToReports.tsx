import { Trans } from '@lingui/react/macro';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

/** "← Reports" link back to the Reports home. */
export function BackToReports() {
  return (
    <Link
      to="/reports"
      className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      <Trans>Reports</Trans>
    </Link>
  );
}
