import { useLingui } from '@lingui/react/macro';
import { SnapshotHistoryList } from '@features/snapshot-history';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

export default function SnapshotHistoryPage() {
  const { t } = useLingui();
  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-4">
      <SettingsPageHeader
        title={t`Earlier versions`}
        description={t`Copies of this workspace kept by the server, to undo a sync problem.`}
      />
      <SnapshotHistoryList />
    </div>
  );
}
