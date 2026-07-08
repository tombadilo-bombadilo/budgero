import { Button } from '@shared/ui/button';
import { Trash2 } from 'lucide-react';

interface ReceiptPreviewProps {
  imagePreview: string;
  fileName?: string;
  onRemove: () => void;
}

export function ReceiptPreview({ imagePreview, fileName, onRemove }: ReceiptPreviewProps) {
  return (
    <div className="space-y-3">
      <div className="relative rounded-lg overflow-hidden border">
        <img
          src={imagePreview}
          alt="Receipt preview"
          className="w-full max-h-[300px] object-contain bg-muted/30"
        />
        <Button
          variant="destructive"
          size="icon"
          className="absolute top-2 right-2"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {fileName && <p className="text-xs text-muted-foreground text-center">{fileName}</p>}
    </div>
  );
}
