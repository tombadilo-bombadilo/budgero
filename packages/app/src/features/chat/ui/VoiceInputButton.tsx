import { Mic, MicOff, Loader2, Download } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { Progress } from '@shared/ui/progress';
import { useWhisperVoiceInput } from '@shared/hooks/useWhisperVoiceInput';
import { useChatStore } from '@features/chat/model/useChatStore';
import { useChatSettings } from '@features/chat/api/useChat';
import { useUiStore } from '@shared/store/useUiStore';
import { cn } from '@shared/lib/utils';

interface VoiceInputButtonProps {
  disabled?: boolean;
}

export function VoiceInputButton({ disabled = false }: VoiceInputButtonProps) {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const budgetId = selectedBudget?.ID ?? null;
  const { data: chatSettings } = useChatSettings(budgetId);
  const { setTranscription } = useChatStore();

  const {
    isRecording,
    isTranscribing,
    isModelLoading,
    isModelReady,
    modelLoadProgress,
    modelLoadMessage,
    recordingDuration,
    error,
    isSupported,
    startListening,
    stopListening,
  } = useWhisperVoiceInput({
    modelSize: chatSettings?.SpeechModel || 'base',
    onTranscript: (text) => {
      if (text) {
        setTranscription(text);
      }
    },
  });

  if (chatSettings && !chatSettings.VoiceInputEnabled) {
    return null;
  }

  if (!isSupported) {
    return null;
  }

  const handleClick = async () => {
    if (isRecording) {
      await stopListening();
    } else if (!isModelLoading && !isTranscribing) {
      await startListening();
    }
  };

  const getTooltipContent = () => {
    if (error) return error;
    if (isModelLoading) return modelLoadMessage || 'Loading speech model...';
    if (isTranscribing) return 'Transcribing...';
    if (isRecording) return `Recording... ${formatDuration(recordingDuration)} (click to stop)`;
    if (!isModelReady) return 'Click to start voice input (model will download on first use)';
    return 'Click to speak';
  };

  const getButtonIcon = () => {
    if (isModelLoading) {
      return <Download className="h-4 w-4 animate-bounce" />;
    }
    if (isTranscribing) {
      return <Loader2 className="h-4 w-4 animate-spin" />;
    }
    if (isRecording) {
      return <MicOff className="h-4 w-4" />;
    }
    return <Mic className="h-4 w-4" />;
  };

  const getButtonVariant = () => {
    if (isRecording) return 'destructive';
    if (isModelLoading || isTranscribing) return 'secondary';
    return 'outline';
  };

  const isButtonDisabled = disabled || isTranscribing;

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={getButtonVariant()}
            size="icon"
            onClick={handleClick}
            disabled={isButtonDisabled}
            className={cn(isRecording && 'animate-pulse', isModelLoading && 'cursor-wait')}
            aria-label={
              isRecording
                ? 'Stop recording'
                : isModelLoading
                  ? 'Loading model'
                  : isTranscribing
                    ? 'Transcribing'
                    : 'Start voice input'
            }
          >
            {getButtonIcon()}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p>{getTooltipContent()}</p>
            {isModelLoading && modelLoadProgress > 0 && (
              <Progress value={modelLoadProgress} className="h-1.5 w-32" />
            )}
            {isRecording && <p className="text-xs text-muted-foreground">Click to stop</p>}
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Recording indicator badge */}
      {isRecording && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
      )}
    </div>
  );
}

/**
 * Format duration in seconds to MM:SS
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
