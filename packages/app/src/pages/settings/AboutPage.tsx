import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Separator } from '@shared/ui/separator';
import { Button } from '@shared/ui/button';
import { openQuackback } from '@features/feedback';
import { toast } from 'sonner';
import { useServiceWorkerUpdate } from '@shared/pwa/ServiceWorkerUpdateProvider';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

import packageJson from '../../../package.json?json';

type PackageMeta = {
  version?: string;
  license?: string;
  homepage?: string;
  repository?: string | { url?: string };
};

const pkg = packageJson as PackageMeta;

const communityBadgeClass =
  'inline-flex h-6 w-6 items-center justify-center rounded-full text-[0.625rem] font-semibold text-white';

export default function AboutPage() {
  const { t } = useLingui();

  const buildChannel = 'Web';
  const repoLink = useMemo(() => {
    if (!pkg.repository) return undefined;
    if (typeof pkg.repository === 'string') return pkg.repository;
    return pkg.repository.url;
  }, []);

  const swUpdates = useServiceWorkerUpdate();
  const handleUpdateServiceWorker = useCallback(async () => {
    if (!swUpdates.isSupported) {
      toast.error(t`Service worker updates are not available in this build.`);
      return;
    }
    await swUpdates.checkForUpdates();
  }, [swUpdates, t]);

  const rows: { label: string; value: string }[] = [
    { label: t`Version`, value: pkg.version ?? 'Unknown' },
    {
      label: t`Build`,
      value: typeof __APP_BUILD_SHA__ === 'string' ? __APP_BUILD_SHA__ : 'Unknown',
    },
    { label: t`Build Channel`, value: buildChannel },
    { label: t`Environment`, value: import.meta.env.MODE },
    { label: t`License`, value: pkg.license ?? 'All rights reserved' },
  ];

  return (
    <div className="container max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-24 sm:pb-6">
      <SettingsPageHeader
        title={t`About Budgero`}
        description={t`A quick overview of this Budgero installation, including version and useful links.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Application Details</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Build metadata for support or troubleshooting.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {rows.map((item, _index) => (
              <div
                key={item.label}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2"
              >
                <span className="text-sm font-medium text-muted-foreground">{item.label}</span>
                <span className="text-sm sm:text-base font-medium text-foreground">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Project Resources</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Learn more about Budgero or get in touch with the team.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-foreground">
                <Trans>Website</Trans>
              </p>
              <a
                href="https://budgero.app"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                https://budgero.app
              </a>
            </div>
            {repoLink && (
              <div>
                <p className="font-medium text-foreground">
                  <Trans>Repository</Trans>
                </p>
                <a
                  href={repoLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {repoLink.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
            <div>
              <p className="font-medium text-foreground">
                <Trans>Support</Trans>
              </p>
              <a href="mailto:hello@budgero.app" className="text-primary hover:underline">
                hello@budgero.app
              </a>
            </div>
            <div>
              <p className="font-medium text-foreground">
                <Trans>Discord Community</Trans>
              </p>
              <a
                href="https://discord.gg/ZgWnzaPqae"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-2"
              >
                <Trans>
                  <span className={`${communityBadgeClass} bg-[#5865F2]`}>D</span>Join our Discord
                </Trans>
              </a>
            </div>
            <div>
              <p className="font-medium text-foreground">
                <Trans>Reddit Community</Trans>
              </p>
              <a
                href="https://www.reddit.com/r/budgero/"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-2"
              >
                <Trans>
                  <span className={`${communityBadgeClass} bg-[#FF4500]`}>R</span>r/budgero
                </Trans>
              </a>
            </div>
            <div>
              <p className="font-medium text-foreground">
                <Trans>Product Feedback</Trans>
              </p>
              <button
                type="button"
                onClick={openQuackback}
                className="text-primary hover:underline"
              >
                <Trans>Share feedback</Trans>
              </button>
            </div>
            <div>
              <p className="font-medium text-foreground">
                <Trans>Report a Bug</Trans>
              </p>
              <button
                type="button"
                onClick={openQuackback}
                className="text-primary hover:underline"
              >
                <Trans>Submit a bug report</Trans>
              </button>
            </div>
            <div>
              <p className="font-medium text-foreground">
                <Trans>Changelog</Trans>
              </p>
              <a
                href="https://budgero.app/changelog"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                <Trans>Latest updates</Trans>
              </a>
            </div>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            <Trans>
              Budgero is continually updated. If you experience issues, share the version
              information above when contacting support so we can help quickly.
            </Trans>
          </p>
          <div className="flex flex-wrap gap-2">
            {swUpdates.isSupported && (
              <Button
                type="button"
                variant="outline"
                onClick={handleUpdateServiceWorker}
                disabled={swUpdates.isChecking}
              >
                <Trans>Update Service Worker</Trans>
              </Button>
            )}
            <Button asChild variant="outline">
              <a
                href="https://budgero.app/changelog"
                target="_blank"
                rel="noreferrer"
                className="no-underline"
              >
                <Trans>View Changelog</Trans>
              </a>
            </Button>
            {swUpdates.lastCheckMessage && (
              <p className="basis-full text-xs text-muted-foreground">
                {swUpdates.lastCheckMessage}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
