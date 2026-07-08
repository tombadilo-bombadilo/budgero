import { useState, useCallback, useEffect, useRef } from 'react';
import { useAudioRecorder } from '@shared/hooks/useAudioRecorder';
import {
  getWhisperService,
  type WhisperModelSize,
  type WhisperProgress,
} from '@shared/lib/whisper/whisper-service';
import { getErrorMessage } from '@shared/lib/errors';

export type VoiceInputState = 'idle' | 'loading_model' | 'recording' | 'transcribing' | 'error';

export interface UseWhisperVoiceInputOptions {
  modelSize?: WhisperModelSize;
  language?: string; // e.g., 'en', 'sr', or undefined for auto-detect
  onTranscript?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export interface UseWhisperVoiceInputReturn {
  state: VoiceInputState;
  isRecording: boolean;
  isTranscribing: boolean;
  isModelLoading: boolean;
  isModelReady: boolean;

  modelLoadProgress: number;
  modelLoadMessage: string;
  recordingDuration: number;

  transcript: string;
  error: string | null;

  startListening: () => Promise<void>;
  stopListening: () => Promise<string | null>;
  cancelListening: () => void;

  isSupported: boolean;
}

/**
 * Hook for voice input using Whisper for on-device speech recognition
 * Combines audio recording with Whisper transcription
 */
export function useWhisperVoiceInput(
  options: UseWhisperVoiceInputOptions = {}
): UseWhisperVoiceInputReturn {
  const { modelSize = 'base', language, onTranscript, onError } = options;

  const [state, setState] = useState<VoiceInputState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modelLoadProgress, setModelLoadProgress] = useState(0);
  const [modelLoadMessage, setModelLoadMessage] = useState('');
  const whisperServiceRef = useRef(getWhisperService());
  const [isModelReady, setIsModelReady] = useState(() => getWhisperService().isReady());
  const audioRecorder = useAudioRecorder();

  // Subscribe to progress updates from whisper service
  useEffect(() => {
    const service = whisperServiceRef.current;
    // Note: isModelReady is initialized from service.isReady() in useState above

    const unsubscribe = service.onProgress((progress: WhisperProgress) => {
      setModelLoadProgress(progress.progress);
      setModelLoadMessage(progress.message);

      if (progress.status === 'ready') {
        setIsModelReady(true);
        if (state === 'loading_model') {
          setState('idle');
        }
      } else if (progress.status === 'error') {
        setError(progress.message);
        setState('error');
        onError?.(progress.message);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [state, onError]);

  const { isSupported } = audioRecorder;

  const startListening = useCallback(async () => {
    if (!isSupported) {
      const err = 'Voice input is not supported in this browser';
      setError(err);
      setState('error');
      onError?.(err);
      return;
    }

    setError(null);
    setTranscript('');

    const service = whisperServiceRef.current;

    if (!service.isReady() || service.getLoadedModel() !== modelSize) {
      setState('loading_model');
      setModelLoadProgress(0);
      setModelLoadMessage('Initializing...');

      try {
        await service.initialize({ modelSize, language });
        setIsModelReady(true);
      } catch (err) {
        const errMsg = getErrorMessage(err, 'Failed to load speech model');
        setError(errMsg);
        setState('error');
        onError?.(errMsg);
        return;
      }
    }

    setState('recording');
    try {
      await audioRecorder.startRecording();
    } catch (err) {
      const errMsg = getErrorMessage(err, 'Failed to start recording');
      setError(errMsg);
      setState('error');
      onError?.(errMsg);
    }
  }, [isSupported, modelSize, language, audioRecorder, onError]);

  const stopListening = useCallback(async (): Promise<string | null> => {
    if (!audioRecorder.isRecording) {
      return null;
    }

    const audioBlob = await audioRecorder.stopRecording();

    if (!audioBlob || audioBlob.size === 0) {
      setError('No audio recorded');
      setState('idle');
      return null;
    }

    setState('transcribing');
    const service = whisperServiceRef.current;

    try {
      const result = await service.transcribe(audioBlob, { language });
      setTranscript(result);
      setState('idle');
      onTranscript?.(result);
      return result;
    } catch (err) {
      const errMsg = getErrorMessage(err, 'Transcription failed');
      setError(errMsg);
      setState('error');
      onError?.(errMsg);
      return null;
    }
  }, [audioRecorder, language, onTranscript, onError]);

  const cancelListening = useCallback(() => {
    audioRecorder.cancelRecording();
    setError(null);
    setTranscript('');
    setState('idle');
  }, [audioRecorder]);

  // Handle audio recorder errors - track which error we've processed to avoid re-triggering
  const handledErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const recorderError = audioRecorder.error;
    if (recorderError && state === 'recording' && handledErrorRef.current !== recorderError) {
      handledErrorRef.current = recorderError;
      // Defer to avoid synchronous setState in effect
      requestAnimationFrame(() => {
        setError(recorderError);
        setState('error');
        onError?.(recorderError);
      });
    }
    if (!recorderError || state !== 'recording') {
      handledErrorRef.current = null;
    }
  }, [audioRecorder.error, state, onError]);

  return {
    state,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
    isModelLoading: state === 'loading_model',
    isModelReady,

    modelLoadProgress,
    modelLoadMessage,
    recordingDuration: audioRecorder.duration,

    transcript,
    error,

    startListening,
    stopListening,
    cancelListening,

    isSupported,
  };
}
