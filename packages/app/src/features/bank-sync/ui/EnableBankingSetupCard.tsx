import { Trans, useLingui } from '@lingui/react/macro';
import { useState, type ChangeEvent } from 'react';
import { Check, Copy, ExternalLink, FileKey, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@shared/lib/errors';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { useSaveEnableBankingConnection, useVerifyEnableBankingApp } from '../api/useBankSync';
import { ENABLE_BANKING_CONTROL_PANEL_URL } from '../lib/enable-banking/client';
import { appIdFromFileName, importPrivateKey } from '../lib/enable-banking/jwt';
import { bankRedirectUrl } from '../model/enable-banking-auth';

function ExternalAnchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline inline-flex items-center gap-0.5"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function CopyValue({ value }: { value: string }) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{value}</code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        aria-label={t`Copy`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/** One-time wizard: the user's own Enable Banking app, verified before it's saved. */
export function EnableBankingSetupCard({ budgetId }: { budgetId: number }) {
  const { t } = useLingui();
  const [appId, setAppId] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [fileName, setFileName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const verify = useVerifyEnableBankingApp();
  const save = useSaveEnableBankingConnection();
  const redirectUrl = bankRedirectUrl();
  const busy = verify.isPending || save.isPending;

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    const text = await file.text();
    try {
      await importPrivateKey(text);
    } catch (error) {
      setProblem(getErrorMessage(error, t`That file isn't a private key.`));
      return;
    }
    setPrivateKeyPem(text);
    setFileName(file.name);
    const fromName = appIdFromFileName(file.name);
    if (fromName && !appId.trim()) setAppId(fromName);
  };

  const submit = async () => {
    setProblem(null);
    const credentials = { appId: appId.trim(), privateKeyPem };
    try {
      const application = await verify.mutateAsync(credentials);
      if (application.redirect_urls && !application.redirect_urls.includes(redirectUrl)) {
        setProblem(
          t`The app "${application.name}" doesn't list ${redirectUrl} as a redirect URL. Add it in the Enable Banking control panel, then try again.`
        );
        return;
      }
      await save.mutateAsync({ budgetId, credentials, application });
      toast.success(t`Enable Banking app "${application.name}" connected`);
    } catch (error) {
      setProblem(getErrorMessage(error, t`Couldn't verify the app with Enable Banking`));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Trans>Connect European banks with Enable Banking</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Enable Banking is free for personal use with your own accounts. You register your own
            app with them once; Budgero signs requests with its key on this device.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal pl-5 text-sm space-y-2 text-muted-foreground">
          <li>
            <Trans>
              Create a free account in the{' '}
              <ExternalAnchor href={ENABLE_BANKING_CONTROL_PANEL_URL}>
                Enable Banking control panel
              </ExternalAnchor>
              .
            </Trans>
          </li>
          <li className="space-y-1">
            <span>
              <Trans>
                Register a new application (Production for your real banks, Sandbox to try a mock
                bank). Use this redirect URL and choose to generate the private key in the browser:
              </Trans>
            </span>
            <CopyValue value={redirectUrl} />
          </li>
          <li>
            <Trans>
              For a Production app, use "Activate by linking accounts" and link every account you
              want to sync. Accounts you don't link there come back empty.
            </Trans>
          </li>
          <li>
            <Trans>Upload the downloaded .pem key and enter the application ID.</Trans>
          </li>
        </ol>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="eb-key">
              <Trans>Private key (.pem)</Trans>
            </Label>
            <label
              htmlFor="eb-key"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm hover:bg-muted/50"
            >
              <FileKey className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{fileName || <Trans>Choose the key file</Trans>}</span>
            </label>
            <input
              id="eb-key"
              type="file"
              accept=".pem,.key,application/x-pem-file"
              className="sr-only"
              onChange={(event) => void onFile(event)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eb-app-id">
              <Trans>Application ID</Trans>
            </Label>
            <Input
              id="eb-app-id"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {problem && <p className="text-xs text-destructive whitespace-pre-line">{problem}</p>}
          <Button onClick={() => void submit()} disabled={busy || !appId.trim() || !privateKeyPem}>
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            <Trans>Verify and save</Trans>
          </Button>
        </div>

        <p className="flex items-start gap-1.5 text-[0.6875rem] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-px" />
          <Trans>
            The key is stored encrypted inside this budget and is never sent anywhere else. Requests
            are encrypted from this browser all the way to Enable Banking; Budgero's relay only
            forwards traffic it can't read. Anyone you share this budget with can sync it too.
          </Trans>
        </p>
      </CardContent>
    </Card>
  );
}
