import { Trans, useLingui } from '@lingui/react/macro';
import {
  MutationLogCard,
  PendingChangesCard,
  SyncActions,
  SyncPositionCard,
  VersionsCard,
} from '@features/sync-diagnostics';
import { Link } from 'react-router-dom';
import { ArchiveRestore } from 'lucide-react';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';
import { Badge } from '@shared/ui/badge';

export default function SyncStatusPage() {
  const { t } = useLingui();
  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-4">
      <SettingsPageHeader
        title={t`Sync status`}
        description={t`How this device's data compares to the server, and what is still syncing.`}
      />
      <SyncActions />
      <SyncPositionCard />
      <PendingChangesCard />
      <MutationLogCard />
      <VersionsCard />
      <Link
        to="/settings/sync/history"
        className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted"
      >
        <ArchiveRestore className="h-4 w-4" />
        <Trans>Earlier versions of this workspace</Trans>
        <Badge variant="outline" className="text-[11px]">
          <Trans>Beta</Trans>
        </Badge>
      </Link>
    </div>
  );
}
