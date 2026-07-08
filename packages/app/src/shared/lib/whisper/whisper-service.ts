// Extend Window for Safari's webkitAudioContext
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export type WhisperModelSize = 'tiny' | 'base' | 'small';

export interface WhisperConfig {
  modelSize: WhisperModelSize;
  language?: string;
}

export interface WhisperProgress {
  status: 'loading' | 'downloading' | 'ready' | 'error';
  progress: number;
  message: string;
}

type ProgressCallback = (progress: WhisperProgress) => void;

interface WorkerProgressResponse {
  type: 'progress';
  status: 'loading' | 'downloading' | 'ready' | 'error';
  progress: number;
  message: string;
}

interface WorkerTranscriptResponse {
  type: 'transcript';
  text: string;
}

interface WorkerErrorResponse {
  type: 'error';
  error: string;
}

type WorkerResponse = WorkerProgressResponse | WorkerTranscriptResponse | WorkerErrorResponse;

class WhisperService {
  private static instance: WhisperService | null = null;

  private worker: Worker | null = null;

  private currentModel: WhisperModelSize | null = null;

  private isLoading = false;

  private isReady_ = false;

  private loadError: string | null = null;

  private progressCallbacks: Set<ProgressCallback> = new Set();

  private initResolve: (() => void) | null = null;

  private initReject: ((error: Error) => void) | null = null;

  private transcribeResolve: ((text: string) => void) | null = null;

  private transcribeReject: ((error: Error) => void) | null = null;

  private constructor() {
    /* singleton: use getInstance() */
  }

  static getInstance(): WhisperService {
    if (!WhisperService.instance) {
      WhisperService.instance = new WhisperService();
    }
    return WhisperService.instance;
  }

  /**
   * Subscribe to loading progress updates
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  private notifyProgress(progress: WhisperProgress): void {
    this.progressCallbacks.forEach((cb) => cb(progress));
  }

  /**
   * Check if model is loaded and ready
   */
  isReady(): boolean {
    return this.isReady_ && !this.isLoading;
  }

  /**
   * Check if currently loading a model
   */
  isModelLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Get the currently loaded model size
   */
  getLoadedModel(): WhisperModelSize | null {
    return this.currentModel;
  }

  /**
   * Get any loading error
   */
  getError(): string | null {
    return this.loadError;
  }

  private createWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    // Create worker using Vite's worker import syntax
    this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (event) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('[WhisperService] Worker error:', error);
      this.loadError = error.message || 'Worker error';
      this.isLoading = false;
      this.isReady_ = false;

      if (this.initReject) {
        this.initReject(new Error(this.loadError));
        this.initResolve = null;
        this.initReject = null;
      }

      if (this.transcribeReject) {
        this.transcribeReject(new Error(this.loadError));
        this.transcribeResolve = null;
        this.transcribeReject = null;
      }

      this.notifyProgress({
        status: 'error',
        progress: 0,
        message: this.loadError,
      });
    };

    return this.worker;
  }

  private handleWorkerMessage(data: WorkerResponse): void {
    switch (data.type) {
      case 'progress':
        this.notifyProgress({
          status: data.status,
          progress: data.progress,
          message: data.message,
        });

        if (data.status === 'ready') {
          this.isReady_ = true;
          this.isLoading = false;
          if (this.initResolve) {
            this.initResolve();
            this.initResolve = null;
            this.initReject = null;
          }
        } else if (data.status === 'error') {
          this.loadError = data.message;
          this.isLoading = false;
          this.isReady_ = false;
        }
        break;

      case 'transcript':
        if (this.transcribeResolve) {
          this.transcribeResolve(data.text);
          this.transcribeResolve = null;
          this.transcribeReject = null;
        }
        break;

      case 'error':
        this.loadError = data.error;
        if (this.initReject) {
          this.initReject(new Error(data.error));
          this.initResolve = null;
          this.initReject = null;
        }
        if (this.transcribeReject) {
          this.transcribeReject(new Error(data.error));
          this.transcribeResolve = null;
          this.transcribeReject = null;
        }
        break;
    }
  }

  /**
   * Initialize/load the Whisper model in the worker
   */
  async initialize(config: WhisperConfig = { modelSize: 'base' }): Promise<void> {
    // If already loading, wait for it
    if (this.isLoading) {
      return new Promise((resolve, reject) => {
        const checkLoading = setInterval(() => {
          if (!this.isLoading) {
            clearInterval(checkLoading);
            if (this.loadError) {
              reject(new Error(this.loadError));
            } else {
              resolve();
            }
          }
        }, 100);
      });
    }

    if (this.isReady_ && this.currentModel === config.modelSize) {
      return;
    }

    this.isLoading = true;
    this.loadError = null;
    this.currentModel = config.modelSize;

    const worker = this.createWorker();

    return new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;

      worker.postMessage({
        type: 'init',
        modelSize: config.modelSize,
      });
    });
  }

  /**
   * Transcribe audio blob to text (runs in worker)
   */
  async transcribe(audioBlob: Blob, options: { language?: string } = {}): Promise<string> {
    if (!this.worker || !this.isReady_) {
      throw new Error('Whisper model not loaded. Call initialize() first.');
    }

    // Capture worker reference for use in Promise callback
    const { worker } = this;

    const audioData = await this.decodeAudio(audioBlob);

    return new Promise((resolve, reject) => {
      this.transcribeResolve = resolve;
      this.transcribeReject = reject;

      worker.postMessage({
        type: 'transcribe',
        audioData,
        language: options.language,
      });
    });
  }

  /**
   * Decode audio Blob to Float32Array at 16kHz
   */
  private async decodeAudio(audioBlob: Blob): Promise<Float32Array> {
    const arrayBuffer = await audioBlob.arrayBuffer();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AudioContext not supported in this browser');
    }
    const audioContext = new AudioContextClass({ sampleRate: 16000 });

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      let audioData: Float32Array;
      if (audioBuffer.numberOfChannels === 1) {
        audioData = audioBuffer.getChannelData(0);
      } else {
        // Mix to mono
        const channel0 = audioBuffer.getChannelData(0);
        const channel1 = audioBuffer.getChannelData(1);
        audioData = new Float32Array(channel0.length);
        for (let i = 0; i < channel0.length; i++) {
          audioData[i] = (channel0[i] + channel1[i]) / 2;
        }
      }

      if (audioBuffer.sampleRate !== 16000) {
        audioData = this.resample(audioData, audioBuffer.sampleRate, 16000);
      }

      return audioData;
    } finally {
      await audioContext.close();
    }
  }

  /**
   * Simple linear resampling
   */
  private resample(
    audioData: Float32Array,
    fromSampleRate: number,
    toSampleRate: number
  ): Float32Array {
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
      const t = srcIndex - srcIndexFloor;
      result[i] = audioData[srcIndexFloor] * (1 - t) + audioData[srcIndexCeil] * t;
    }

    return result;
  }

  /**
   * Terminate the worker and free resources
   */
  unload(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.currentModel = null;
    this.isReady_ = false;
    this.loadError = null;
    this.initResolve = null;
    this.initReject = null;
    this.transcribeResolve = null;
    this.transcribeReject = null;
  }
}

export const getWhisperService = WhisperService.getInstance.bind(WhisperService);

export { WhisperService };
