import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  isSupportedImportFile,
  SUPPORTED_IMPORT_FORMATS_LABEL,
} from '@features/import/lib/constants';
import { useUiStore } from '@shared/store/useUiStore';
import { toast } from 'sonner';

function hasFilePayload(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function GlobalImportDropHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const setPendingImportFile = useUiStore((state) => state.setPendingImportFile);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      dragDepthRef.current += 1;
      setIsDraggingFile(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      const items = event.dataTransfer?.items;
      if (!items || !Array.from(items).some((item) => item.kind === 'file')) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setIsDraggingFile(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFile(false);
      }
    };

    const handleDragEnd = () => {
      dragDepthRef.current = 0;
      setIsDraggingFile(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFile(false);

      const files = Array.from(event.dataTransfer?.files ?? []);
      const supportedFile = files.find((file) => isSupportedImportFile(file));
      if (!supportedFile) {
        toast.error('Unsupported file', {
          description: `Drop a ${SUPPORTED_IMPORT_FORMATS_LABEL} file to import transactions.`,
        });
        return;
      }

      setPendingImportFile(supportedFile);
      if (!location.pathname.startsWith('/settings/imports')) {
        void navigate('/settings/imports');
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragend', handleDragEnd);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragend', handleDragEnd);
      window.removeEventListener('drop', handleDrop);
    };
  }, [location.pathname, navigate, setPendingImportFile]);

  if (!isDraggingFile) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="rounded-2xl border border-dashed border-primary/60 bg-background px-6 py-4 text-center shadow-2xl">
        <p className="text-lg font-semibold text-foreground">Drop file to import</p>
        <p className="text-sm text-muted-foreground">
          {SUPPORTED_IMPORT_FORMATS_LABEL} files will open the Imports workspace automatically.
        </p>
      </div>
    </div>
  );
}
