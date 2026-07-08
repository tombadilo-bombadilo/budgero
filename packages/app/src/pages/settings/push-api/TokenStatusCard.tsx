import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Badge } from '@shared/ui/badge';
import { Switch } from '@shared/ui/switch';
import { Separator } from '@shared/ui/separator';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Key, Copy, AlertTriangle, CheckCircle, Clock, Eye, EyeOff, Loader2 } from 'lucide-react';
import type { PushApiState } from './usePushApiState';

interface TokenStatusCardProps {
  state: PushApiState;
}

export function TokenStatusCard({ state }: TokenStatusCardProps) {
  const {
    tokenStatus,
    newToken,
    showToken,
    setShowToken,
    toggleTokenMutation,
    generateTokenMutation,
    handleGenerateToken,
    handleCopyToken,
    formatDate,
  } = state;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          API Token
        </CardTitle>
        <CardDescription>
          Generate an API token to authenticate requests to the Push API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tokenStatus?.has_token ? (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status</span>
                  {tokenStatus.is_enabled ? (
                    <Badge variant="default" className="bg-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </div>
              </div>
              <Switch
                checked={tokenStatus.is_enabled}
                onCheckedChange={(checked) => toggleTokenMutation.mutate(checked)}
                disabled={toggleTokenMutation.isPending}
              />
            </div>

            <Separator />

            <div className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDate(tokenStatus.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Used</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(tokenStatus.last_used)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Space ID</span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{tokenStatus.space_id}</code>
              </div>
            </div>

            {newToken && (
              <>
                <Separator />
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Save your token now!</strong> It won't be shown again.
                  </AlertDescription>
                </Alert>
                <div className="space-y-2">
                  <Label>Your API Token</Label>
                  <div className="flex gap-2">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={newToken}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" onClick={() => setShowToken(!showToken)}>
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button variant="outline" size="icon" onClick={handleCopyToken}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You haven't generated an API token yet. Generate one to start using the Push API.
            </p>
            <Button onClick={handleGenerateToken} disabled={generateTokenMutation.isPending}>
              {generateTokenMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Generate API Token
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
