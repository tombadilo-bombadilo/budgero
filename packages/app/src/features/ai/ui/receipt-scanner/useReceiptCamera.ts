import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Shared getUserMedia-backed camera capture for receipt images.
 *
 * Owns the video/canvas refs, the active-stream lifecycle, and the
 * capture-to-File conversion. What happens with the captured file is
 * caller-owned via `onCapture` (e.g. the receipt scanner resets to its
 * 'upload' step; the warranties page sets a preview directly).
 */
export function useReceiptCamera(onCapture: (file: File) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Attach stream to video element when camera activates
  useEffect(() => {
    if (cameraActive && streamRef.current) {
      const timer = setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [cameraActive]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      return true;
    } catch {
      toast.error('Camera access denied', {
        description: 'Please allow camera access or use file upload instead.',
      });
      return false;
    }
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopCamera();
        onCapture(file);
      },
      'image/jpeg',
      0.9
    );
  }, [stopCamera, onCapture]);

  return {
    videoRef,
    canvasRef,
    cameraActive,
    startCamera,
    stopCamera,
    capturePhoto,
  };
}
