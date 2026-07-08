import { useState, useRef, useCallback } from 'react';

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  isPaused: boolean;
  error: string | null;
  duration: number; // Recording duration in seconds

  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;

  isSupported: boolean;
}

/**
 * Hook for recording audio using MediaRecorder API
 * Returns audio as a Blob suitable for Whisper transcription
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null);

  const isSupported =
    typeof window !== 'undefined' && 'MediaRecorder' in window && 'mediaDevices' in navigator;

  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setDuration(0);
  }, []);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError('Audio recording is not supported in this browser');
      return;
    }

    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Mono for better compatibility
          sampleRate: 16000, // Whisper prefers 16kHz
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;

      // Prefer webm/opus as it's widely supported and good quality
      const mimeType = getSupportedMimeType();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        if (resolveStopRef.current) {
          resolveStopRef.current(audioBlob);
          resolveStopRef.current = null;
        }

        cleanup();
        setIsRecording(false);
        setIsPaused(false);
      };

      mediaRecorder.onerror = (event: Event) => {
        console.error('[AudioRecorder] MediaRecorder error:', event);
        const errorEvent = event as Event & { error?: { message?: string } };
        setError(errorEvent.error?.message || 'Recording error');
        cleanup();
        setIsRecording(false);
        setIsPaused(false);

        if (resolveStopRef.current) {
          resolveStopRef.current(null);
          resolveStopRef.current = null;
        }
      };

      // Start recording - request data every 1 second
      mediaRecorder.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);

      const startTime = Date.now();
      durationIntervalRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } catch (err) {
      console.error('[AudioRecorder] Failed to start recording:', err);

      const domError = err as { name?: string; message?: string };
      if (domError.name === 'NotAllowedError' || domError.name === 'PermissionDeniedError') {
        setError('Microphone permission denied. Please allow microphone access.');
      } else if (domError.name === 'NotFoundError' || domError.name === 'DevicesNotFoundError') {
        setError('No microphone found. Please connect a microphone.');
      } else {
        setError(domError.message || 'Failed to start recording');
      }

      cleanup();
    }
  }, [isSupported, cleanup]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !isRecording) {
        resolve(null);
        return;
      }

      resolveStopRef.current = resolve;

      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      } else {
        // Already stopped, return current chunks
        const { mimeType } = mediaRecorderRef.current;
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        cleanup();
        setIsRecording(false);
        setIsPaused(false);
        resolve(audioBlob);
      }
    });
  }, [isRecording, cleanup]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }
  }, [isRecording, isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);

      const currentDuration = duration;
      const resumeTime = Date.now();
      durationIntervalRef.current = window.setInterval(() => {
        setDuration(currentDuration + Math.floor((Date.now() - resumeTime) / 1000));
      }, 1000);
    }
  }, [isRecording, isPaused, duration]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      // Clear the resolve callback so we don't return data
      resolveStopRef.current = null;

      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }

    cleanup();
    setIsRecording(false);
    setIsPaused(false);
    setError(null);
  }, [cleanup]);

  return {
    isRecording,
    isPaused,
    error,
    duration,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    isSupported,
  };
}

function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/wav',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  // Fallback - let browser choose
  return '';
}
