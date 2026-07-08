import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Shield, Copy, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import type { PushApiState } from './usePushApiState';

interface EncryptionInfoPanelProps {
  state: PushApiState;
}

export function EncryptionInfoPanel({ state }: EncryptionInfoPanelProps) {
  const {
    encryptionInfo,
    showEncryptionKey,
    encryptionKey,
    handleRevealEncryptionKey,
    handleCopyEncryptionKey,
    handleHideEncryptionKey,
  } = state;

  return (
    <>
      {/* Encryption Key Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Encryption Key
          </CardTitle>
          <CardDescription>
            Export your encryption key for use with external tools like the Python script.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Security Warning:</strong> Your encryption key can decrypt all your budget
              data. Never share it publicly and store it securely.
            </AlertDescription>
          </Alert>

          {showEncryptionKey && encryptionKey ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Your Encryption Key (Base64)</Label>
                <div className="flex gap-2">
                  <Input type="text" value={encryptionKey} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={handleCopyEncryptionKey}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This key will automatically hide in 60 seconds.
                </p>
              </div>
              <Button variant="outline" onClick={handleHideEncryptionKey}>
                <EyeOff className="h-4 w-4 mr-2" />
                Hide Key
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={handleRevealEncryptionKey}>
              <Eye className="h-4 w-4 mr-2" />
              Reveal Encryption Key
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Encryption Details Card */}
      {encryptionInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Encryption Details</CardTitle>
            <CardDescription>Technical details for encrypting your payloads.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Algorithm</span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  {encryptionInfo.info.algorithm}
                </code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Encoding</span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  {encryptionInfo.info.encoding}
                </code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Key Source</span>
                <span className="text-xs">{encryptionInfo.info.key_derivation}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supported Operations</span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  {encryptionInfo.info.supported_opcodes}
                </code>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
