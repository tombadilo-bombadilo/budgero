import { Trans, useLingui } from '@lingui/react/macro';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { Input } from '@shared/ui/input';
import { Button } from '@shared/ui/button';
import { Switch } from '@shared/ui/switch';
import { Checkbox } from '@shared/ui/checkbox';
import { Separator } from '@shared/ui/separator';
import { Badge } from '@shared/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Bot, Sparkles, ImagePlus, MessageCircle, Mic, ShieldCheck, Zap } from 'lucide-react';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';
import { AICategorizeDialog } from '@features/ai/ui/AICategorizeDialog';
import { AIReceiptScannerDialog } from '@features/ai/ui/receipt-scanner';
import type { ExecutionMode, SpeechModel } from '@budgero/core/browser';

import { CenteredLoader } from '@shared/ui/CenteredLoader';
import { CHAT_TOOL_DEFS, isToolEnabled } from '@features/ai/lib/tools';
import { useAISettingsState } from './useAISettingsState';
import { isCloudEndpoint } from './ai-settings.constants';
import { PrivacyWarnings } from './PrivacyWarnings';
import { ProviderSection } from './ProviderSection';
import { ConnectionTestPanel } from './ConnectionTestPanel';
import { ModelSelectionSection } from './ModelSelectionSection';
import { RecommendedModelsPanel } from './RecommendedModelsPanel';

export default function AISettingsPage() {
  const { t } = useLingui();

  const state = useAISettingsState();
  const isCloud = isCloudEndpoint(state.endpointURL, state.apiKey);

  if (state.budgetId > 0 && state.isLoading && !state.isFetched) {
    return (
      <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
        <CenteredLoader variant="icon" className="py-12" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      {/* Page Header */}
      <SettingsPageHeader
        title={
          <Trans>
            AI Assistant{' '}
            <span className="text-base font-normal text-muted-foreground">
              <Trans>(Experimental)</Trans>
            </span>
          </Trans>
        }
        description={t`Connect to a local LLM for privacy, or any OpenAI-compatible provider with an API key`}
      />

      {/* AI Configuration Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <CardTitle>
                <Trans>AI Assistant</Trans>
              </CardTitle>
            </div>
            <Switch
              checked={state.enabled}
              onCheckedChange={state.setEnabled}
              aria-label={t`Enable AI features`}
            />
          </div>
          <CardDescription>
            <Trans>
              Connect to a local LLM (Ollama, LM Studio) for maximum privacy, or point at a remote
              OpenAI-compatible API. Local servers keep your data on-device; remote ones do not.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <PrivacyWarnings isCloud={isCloud} />

          <div className="space-y-4">
            <ProviderSection
              provider={state.provider}
              onProviderChange={state.handleProviderChange}
            />

            <Separator />

            <ConnectionTestPanel
              provider={state.provider}
              endpointURL={state.endpointURL}
              apiKey={state.apiKey}
              connectionStatus={state.connectionStatus}
              connectionError={state.connectionError}
              availableModels={state.availableModels}
              onEndpointChange={state.handleEndpointChange}
              onApiKeyChange={state.handleApiKeyChange}
              onTestConnection={state.handleTestConnection}
            />

            <Separator />

            <ModelSelectionSection
              textModel={state.textModel}
              visionModel={state.visionModel}
              availableModels={state.availableModels}
              textModelOpen={state.textModelOpen}
              visionModelOpen={state.visionModelOpen}
              onTextModelChange={state.setTextModel}
              onVisionModelChange={state.setVisionModel}
              onTextModelOpenChange={state.setTextModelOpen}
              onVisionModelOpenChange={state.setVisionModelOpen}
            />

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="contextLength">
                <Trans>Context Window</Trans>
              </Label>
              <Input
                id="contextLength"
                type="number"
                min={0}
                step={1024}
                value={state.contextLength ?? ''}
                onChange={(e) => state.handleContextLengthChange(e.target.value)}
                placeholder="e.g. 256000"
                className="w-full sm:w-48"
              />
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Max tokens the model accepts, used for the chat usage meter. Auto-detected for
                  Ollama and LM Studio; set it manually for cloud models (e.g. 256000 for Kimi
                  K2.6). Leave empty if unknown.
                </Trans>
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={state.handleSave}
              disabled={!state.hasChanges || state.isSaving}
              loading={state.isSaving}
            >
              <Trans>Save Settings</Trans>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI Features Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <Sparkles className="h-5 w-5" />
              AI Features
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Available AI-powered features when connected to a local LLM</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Auto-Categorize Feature */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-medium">
                  <Trans>Auto-Categorize</Trans>
                </h3>
                {state.enabled && state.textModel ? (
                  <Badge variant="default" className="ml-auto">
                    <Trans>Ready</Trans>
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="ml-auto">
                    <Trans>Disabled</Trans>
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Automatically categorize uncategorized transactions using AI analysis of payee
                  names and memos.
                </Trans>
              </p>
              {state.uncategorizedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    {state.uncategorizedCount} transaction
                    {state.uncategorizedCount === 1 ? '' : 's'} waiting
                  </Trans>
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => state.setCategorizeOpen(true)}
                disabled={!state.enabled || !state.textModel || state.uncategorizedCount === 0}
                className="w-full"
              >
                <Trans>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Categorize Now
                </Trans>
              </Button>
            </div>

            {/* Receipt Scanner Feature */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2">
                  <ImagePlus className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-medium">
                  <Trans>Receipt Scanner</Trans>
                </h3>
                {state.enabled && state.visionModel ? (
                  <Badge variant="default" className="ml-auto">
                    <Trans>Ready</Trans>
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="ml-auto">
                    <Trans>Disabled</Trans>
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Extract transactions from receipts and bank statement images using vision AI.
                </Trans>
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => state.setScannerOpen(true)}
                disabled={!state.enabled || !state.visionModel}
                className="w-full"
              >
                <Trans>
                  <ImagePlus className="h-4 w-4 mr-2" />
                  Scan Receipt
                </Trans>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AICategorizeDialog
        open={state.categorizeOpen}
        onOpenChange={state.setCategorizeOpen}
        budgetId={state.budgetId}
      />

      <AIReceiptScannerDialog
        open={state.scannerOpen}
        onOpenChange={state.setScannerOpen}
        budgetId={state.budgetId}
      />

      {/* Chat Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            <CardTitle>
              <Trans>Chat Assistant</Trans>
            </CardTitle>
          </div>
          <CardDescription>
            <Trans>Configure the AI chat assistant behavior and appearance</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            {/* Execution Mode */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="executionMode" className="flex items-center gap-2">
                  <Trans>
                    <ShieldCheck className="h-4 w-4" />
                    Tool Execution Mode
                  </Trans>
                </Label>
                <p className="text-sm text-muted-foreground">
                  <Trans>How should the assistant handle actions like adding transactions?</Trans>
                </p>
              </div>
              <Select
                value={state.chatExecutionMode}
                onValueChange={(value: ExecutionMode) => state.setChatExecutionMode(value)}
              >
                <SelectTrigger id="executionMode" className="w-full sm:w-48">
                  <SelectValue placeholder={t`Select mode`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirm">
                    <div className="flex items-center gap-2">
                      <Trans>
                        <ShieldCheck className="h-4 w-4" />
                        Confirm First
                      </Trans>
                    </div>
                  </SelectItem>
                  <SelectItem value="auto">
                    <div className="flex items-center gap-2">
                      <Trans>
                        <Zap className="h-4 w-4" />
                        Auto-Execute
                      </Trans>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {state.chatExecutionMode === 'confirm'
                ? t`The assistant will ask for confirmation before making changes like adding transactions.`
                : t`The assistant will automatically execute actions without asking for confirmation.`}
            </p>

            <Separator />

            {/* Voice Input */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="voiceEnabled" className="flex items-center gap-2">
                  <Trans>
                    <Mic className="h-4 w-4" />
                    Voice Input
                  </Trans>
                </Label>
                <p className="text-sm text-muted-foreground">
                  <Trans>Enable speech-to-text for voice messages</Trans>
                </p>
              </div>
              <Switch
                id="voiceEnabled"
                checked={state.chatVoiceEnabled}
                onCheckedChange={state.setChatVoiceEnabled}
              />
            </div>

            {/* Speech Model - only shown when voice is enabled */}
            {state.chatVoiceEnabled && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pl-6 border-l-2 border-muted">
                <div className="space-y-0.5">
                  <Label htmlFor="speechModel">
                    <Trans>Speech Model</Trans>
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    <Trans>Whisper model for on-device transcription</Trans>
                  </p>
                </div>
                <Select
                  value={state.chatSpeechModel}
                  onValueChange={(v) => state.setChatSpeechModel(v as SpeechModel)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t`Select model`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tiny">
                      <div className="flex flex-col">
                        <span>
                          <Trans>Tiny</Trans>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          <Trans>~75MB, fastest</Trans>
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="base">
                      <div className="flex flex-col">
                        <span>
                          <Trans>Base</Trans>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          <Trans>~150MB, balanced</Trans>
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="small">
                      <div className="flex flex-col">
                        <span>
                          <Trans>Small</Trans>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          <Trans>~500MB, accurate</Trans>
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            {/* Show Chat Bubble */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="showBubble" className="flex items-center gap-2">
                  <Trans>
                    <MessageCircle className="h-4 w-4" />
                    Show Chat Bubble
                  </Trans>
                </Label>
                <p className="text-sm text-muted-foreground">
                  <Trans>Display the floating chat button</Trans>
                </p>
              </div>
              <Switch
                id="showBubble"
                checked={state.chatShowBubble}
                onCheckedChange={state.setChatShowBubble}
              />
            </div>

            <Separator />

            {/* Context Window */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="contextMonths">
                  <Trans>Context Window</Trans>
                </Label>
                <p className="text-sm text-muted-foreground">
                  <Trans>How many months of budget data to include for context</Trans>
                </p>
              </div>
              <Select
                value={String(state.chatContextMonths)}
                onValueChange={(value) => state.setChatContextMonths(Number(value))}
              >
                <SelectTrigger id="contextMonths" className="w-full sm:w-32">
                  <SelectValue placeholder={t`Select`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">
                    <Trans>1 month</Trans>
                  </SelectItem>
                  <SelectItem value="3">
                    <Trans>3 months</Trans>
                  </SelectItem>
                  <SelectItem value="6">
                    <Trans>6 months</Trans>
                  </SelectItem>
                  <SelectItem value="12">
                    <Trans>12 months</Trans>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Enabled Tools */}
            <div className="space-y-3">
              <div className="space-y-0.5">
                <Label>
                  <Trans>Assistant Tools</Trans>
                </Label>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Choose what the assistant is allowed to do. Disable tools your model handles
                    poorly, or turn on raw SQL for a capable model.
                  </Trans>
                </p>
              </div>
              <div className="space-y-3">
                {CHAT_TOOL_DEFS.map((toolDef) => (
                  <label
                    key={toolDef.key}
                    htmlFor={`tool-${toolDef.key}`}
                    className="flex items-start gap-3 cursor-pointer"
                  >
                    <Checkbox
                      id={`tool-${toolDef.key}`}
                      checked={isToolEnabled(toolDef.key, state.chatEnabledTools)}
                      onCheckedChange={(checked) =>
                        state.handleToggleTool(toolDef.key, checked === true)
                      }
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{toolDef.label}</span>
                        {toolDef.mutating && (
                          <Badge variant="secondary" className="text-[0.625rem]">
                            <Trans>writes data</Trans>
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{toolDef.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={state.handleSaveChatSettings}
              disabled={!state.chatHasChanges || state.isSavingChat}
              loading={state.isSavingChat}
            >
              <Trans>Save Chat Settings</Trans>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recommended Models */}
      <RecommendedModelsPanel />
    </div>
  );
}
