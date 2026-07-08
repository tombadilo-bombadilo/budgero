import { Spinner } from '@shared/ui/spinner';

interface FullScreenLoadingOverlayProps {
  title: string;
  description?: string;
  footnote?: string;
}

export function FullScreenLoadingOverlay({
  title,
  description,
  footnote,
}: FullScreenLoadingOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card rounded-lg p-8 max-w-sm w-full mx-4">
        <div className="flex flex-col items-center space-y-4">
          <Spinner className="h-12 w-12 text-primary" />
          <div className="text-center space-y-2">
            <h3 className="font-semibold text-lg">{title}</h3>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
            {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
