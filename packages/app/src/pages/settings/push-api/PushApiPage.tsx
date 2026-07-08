import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Separator } from '@shared/ui/separator';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { AlertTriangle, Copy, ExternalLink } from 'lucide-react';
import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

import { usePushApiState } from './usePushApiState';
import { TokenStatusCard } from './TokenStatusCard';
import { TokenActions } from './TokenActions';
import { QueueStatsPanel } from './QueueStatsPanel';
import { EncryptionInfoPanel } from './EncryptionInfoPanel';
import { IdReferencePanel } from './IdReferencePanel';
import { RevokeDialog } from './RevokeDialog';
import { RegenerateDialog } from './RegenerateDialog';

export default function PushApiPage() {
  const state = usePushApiState();
  const { isLoadingStatus, statusError, tokenStatus, handleCopyEndpoint } = state;

  if (isLoadingStatus) {
    return (
      <div className="container max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-24 sm:pb-6">
        <CenteredLoader variant="icon" className="py-12" />
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="container max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-24 sm:pb-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to load Push API settings. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-24 sm:pb-6">
      <SettingsPageHeader
        title="Push API"
        description="Send transactions to Budgero from external services using the Push API."
      />

      {/* Token Management Card */}
      <TokenStatusCard state={state} />

      {/* Token Actions (only shown when token exists) */}
      {tokenStatus?.has_token && (
        <Card>
          <CardContent className="pt-6">
            <TokenActions state={state} />
          </CardContent>
        </Card>
      )}

      {/* Encryption Key and Details Cards */}
      {tokenStatus?.has_token && <EncryptionInfoPanel state={state} />}

      {/* Queue Stats Card */}
      {tokenStatus?.has_token && <QueueStatsPanel state={state} />}

      {/* ID Reference Card */}
      {tokenStatus?.has_token && <IdReferencePanel state={state} />}

      {/* API Documentation Card */}
      <Card>
        <CardHeader>
          <CardTitle>API Documentation</CardTitle>
          <CardDescription>How to send transactions to Budgero via the Push API.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Endpoint</Label>
            <div className="flex gap-2">
              <Input
                value={`${window.location.origin}/api/v1/push`}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={handleCopyEndpoint}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium">Authentication</p>
              <p className="text-muted-foreground">
                Include your API token in the Authorization header:
              </p>
              <code className="block mt-1 p-2 bg-muted rounded text-xs">
                Authorization: Bearer YOUR_API_TOKEN
              </code>
            </div>

            <div>
              <p className="font-medium">Request Body</p>
              <p className="text-muted-foreground">Send a JSON object with an encrypted payload:</p>
              <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                {`{
  "encrypted_payload": "base64_encoded_encrypted_data",
  "message_id": "optional-client-generated-id-for-deduplication"
}`}
              </pre>
            </div>

            <div>
              <p className="font-medium">Payload Format v2 (before encryption)</p>
              <p className="text-muted-foreground">
                The decrypted payload should follow this structure. Monetary values are integer
                milliunits — 1/1000 of a currency unit, so 25.50 is sent as{' '}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">25500</code>. Payees are
                referenced by name.
              </p>
              <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                {`{
  "v": 2,
  "op": "transactions.add",
  "args": {
    "inflow": 0,
    "outflow": 25500,
    "accountId": 1,
    "categoryId": 5,
    "budgetId": 1,
    "date": "2024-01-15",
    "memo": "Coffee shop",
    "payee": "Starbucks"
  }
}`}
              </pre>
              <p className="text-muted-foreground mt-1">
                Legacy payloads without the{' '}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">&quot;v&quot;</code> field
                are treated as format 1 (decimal amounts, e.g.{' '}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">25.50</code>) and upgraded on
                import. New integrations should send format 2.
              </p>
            </div>

            <div>
              <p className="font-medium">Encryption</p>
              <p className="text-muted-foreground">
                Use AES-256-GCM encryption with the same key used by the Budgero app. The encrypted
                data format is: IV (12 bytes) + Ciphertext + Auth Tag (16 bytes), then Base64
                encoded.
              </p>
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <a
                href={`${window.location.origin}/api/v1/push/spec`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Full API Spec
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <RevokeDialog state={state} />
      <RegenerateDialog state={state} />
    </div>
  );
}
