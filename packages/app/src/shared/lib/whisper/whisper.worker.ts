import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { getErrorMessage } from '@shared/lib/errors';
import type { WhisperModelSize } from './whisper-service';

// Configure transformers.js for worker context
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_IDS: Record<WhisperModelSize, string> = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
};

let whisperPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let currentModel: WhisperModelSize | null = null;
let isLoading = false;

interface InitMessage {
  type: 'init';
  modelSize: WhisperModelSize;
}

interface TranscribeMessage {
  type: 'transcribe';
  audioData: Float32Array;
  language?: string;
}

type WorkerMessage = InitMessage | TranscribeMessage;

interface ProgressResponse {
  type: 'progress';
  status: 'loading' | 'downloading' | 'ready' | 'error';
  progress: number;
  message: string;
}

interface TranscriptResponse {
  type: 'transcript';
  text: string;
}

interface ErrorResponse {
  type: 'error';
  error: string;
}

type WorkerResponse = ProgressResponse | TranscriptResponse | ErrorResponse;

/** Progress data from transformers.js pipeline */
interface PipelineProgressData {
  status?: string;
  loaded?: number;
  total?: number;
}

/** Result from ASR pipeline - can be various shapes */
interface ASRResultChunk {
  text?: string;
}

const createAsrPipeline = pipeline as unknown as (
  task: 'automatic-speech-recognition',
  model: string,
  options?: {
    progress_callback?: (progressData: PipelineProgressData) => void;
  }
) => Promise<AutomaticSpeechRecognitionPipeline>;

function postResponse(response: WorkerResponse) {
  self.postMessage(response);
}

async function initializeModel(modelSize: WhisperModelSize) {
  if (whisperPipeline && currentModel === modelSize) {
    postResponse({
      type: 'progress',
      status: 'ready',
      progress: 100,
      message: 'Model ready',
    });
    return;
  }

  if (whisperPipeline && currentModel !== modelSize) {
    whisperPipeline = null;
    currentModel = null;
  }

  if (isLoading) {
    return;
  }

  isLoading = true;
  const modelId = MODEL_IDS[modelSize];

  try {
    postResponse({
      type: 'progress',
      status: 'loading',
      progress: 0,
      message: `Loading ${modelSize} model...`,
    });

    whisperPipeline = await createAsrPipeline('automatic-speech-recognition', modelId, {
      progress_callback: (progressData: PipelineProgressData) => {
        if (progressData.status === 'progress' && progressData.total && progressData.loaded) {
          const percent = Math.round((progressData.loaded / progressData.total) * 100);
          postResponse({
            type: 'progress',
            status: 'downloading',
            progress: percent,
            message: `Downloading: ${percent}%`,
          });
        } else if (progressData.status === 'done') {
          postResponse({
            type: 'progress',
            status: 'loading',
            progress: 100,
            message: 'Initializing...',
          });
        }
      },
    });

    currentModel = modelSize;
    isLoading = false;

    postResponse({
      type: 'progress',
      status: 'ready',
      progress: 100,
      message: 'Model ready',
    });
  } catch (error) {
    isLoading = false;
    whisperPipeline = null;
    currentModel = null;

    const errorMessage = getErrorMessage(error, 'Failed to load model');
    postResponse({
      type: 'progress',
      status: 'error',
      progress: 0,
      message: errorMessage,
    });
    postResponse({
      type: 'error',
      error: errorMessage,
    });

    console.error('[WhisperWorker] Failed to load model:', error);
  }
}

async function transcribe(audioData: Float32Array, language?: string) {
  if (!whisperPipeline) {
    postResponse({
      type: 'error',
      error: 'Model not loaded. Call init first.',
    });
    return;
  }

  try {
    const result: unknown = await whisperPipeline(audioData, {
      language,
      task: 'transcribe',
      return_timestamps: false,
    });

    // Handle different result formats from the ASR pipeline
    let text: string;
    if (typeof result === 'string') {
      text = result.trim();
    } else if (Array.isArray(result)) {
      text = result
        .map((r: ASRResultChunk | string) => (typeof r === 'string' ? r : r.text || ''))
        .join(' ')
        .trim();
    } else if (result && typeof result === 'object' && 'text' in result) {
      text = String((result as ASRResultChunk).text || '').trim();
    } else {
      text = String(result).trim();
    }

    postResponse({
      type: 'transcript',
      text,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    console.error('[WhisperWorker] Transcription failed:', error);
    postResponse({
      type: 'error',
      error: `Transcription failed: ${errorMessage}`,
    });
  }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type } = event.data;

  switch (type) {
    case 'init':
      await initializeModel(event.data.modelSize);
      break;
    case 'transcribe':
      await transcribe(event.data.audioData, event.data.language);
      break;
    default:
      console.warn('[WhisperWorker] Unknown message type:', type);
  }
};

self.postMessage({ type: 'ready' });
