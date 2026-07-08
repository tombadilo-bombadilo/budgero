import { Label } from '@shared/ui/label';
import { Input } from '@shared/ui/input';
import { Button } from '@shared/ui/button';
import { Server, KeyRound, Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import type { LLMProvider } from '@budgero/core/browser';
import type { ConnectionStatus } from './useAISettingsState';

interface ConnectionTestPanelProps {
  provider: LLMProvider;
  endpointURL: string;
  apiKey: string;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  availableModels: string[];
  onEndpointChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onTestConnection: () => void;
}

export function ConnectionTestPanel({
  provider,
  endpointURL,
  apiKey,
  connectionStatus,
  connectionError,
  availableModels,
  onEndpointChange,
  onApiKeyChange,
  onTestConnection,
}: ConnectionTestPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="endpoint">Server URL</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Server className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="endpoint"
              value={endpointURL}
              onChange={(e) => onEndpointChange(e.target.value)}
              placeholder="http://localhost:11434"
              className="pl-10"
            />
          </div>
          <Button
            variant="outline"
            onClick={onTestConnection}
            disabled={connectionStatus === 'testing'}
          >
            {connectionStatus === 'testing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">Test</span>
          </Button>
        </div>
        <ConnectionStatusMessage
          status={connectionStatus}
          error={connectionError}
          modelCount={availableModels.length}
          provider={provider}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="Optional — required by most cloud providers"
            className="pl-10"
            autoComplete="off"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Leave empty for local servers (Ollama, LM Studio). Sent as a{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">Bearer</code> token to your
          chosen provider.
        </p>
      </div>
    </div>
  );
}

interface ConnectionStatusMessageProps {
  status: ConnectionStatus;
  error: string | null;
  modelCount: number;
  provider?: LLMProvider;
}

function ConnectionStatusMessage({
  status,
  error,
  modelCount,
  provider,
}: ConnectionStatusMessageProps) {
  if (status === 'success') {
    return (
      <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
        <CheckCircle2 className="h-4 w-4" />
        Connected - {modelCount} models available
      </p>
    );
  }

  if (status === 'error') {
    const isCorsLikely =
      provider === 'ollama' &&
      (error?.includes('Failed to fetch') ||
        error?.includes('NetworkError') ||
        error?.includes('CORS'));

    return (
      <div className="space-y-1">
        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
        {isCorsLikely && (
          <p className="text-xs text-muted-foreground">
            If you're accessing Budgero over HTTPS, Ollama needs to allow your origin. Start Ollama
            with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              OLLAMA_ORIGINS=* ollama serve
            </code>{' '}
            or set the{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">OLLAMA_ORIGINS</code>{' '}
            environment variable in your Ollama service config.
          </p>
        )}
      </div>
    );
  }

  return null;
}
