import { Spinner } from '@shared/ui/spinner';

interface LoadingOverlayProps {
  show: boolean;
}

export function LoadingOverlay({ show }: LoadingOverlayProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Blurred backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm bg-black/20 dark:bg-black/40" />

      {/* Spinner */}
      <Spinner className="relative h-10 w-10 text-primary" />
    </div>
  );
}
