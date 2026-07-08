import { useRef } from 'react';
import { Button } from '@shared/ui/button';
import { Textarea } from '@shared/ui/textarea';
import { Send, Loader2, Paperclip, X } from 'lucide-react';
import { VoiceInputButton } from '../VoiceInputButton';

interface ChatComposerProps {
  inputText: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  isGenerating: boolean;
  disabled: boolean;
  attachedImages: string[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (index: number) => void;
}

export function ChatComposer({
  inputText,
  onInputChange,
  onKeyDown,
  onSend,
  isGenerating,
  disabled,
  attachedImages,
  onAddImages,
  onRemoveImage,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = (inputText.trim().length > 0 || attachedImages.length > 0) && !isGenerating;

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const images = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (images.length > 0) onAddImages(images);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const images = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (images.length > 0) {
      e.preventDefault();
      onAddImages(images);
    }
  };

  return (
    <div className="shrink-0 border-t p-4">
      {attachedImages.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachedImages.map((src, i) => (
            <div key={i} className="relative h-16 w-16 overflow-hidden rounded-md border">
              <img src={src} alt={`attachment ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveImage(i)}
                className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isGenerating || disabled}
          aria-label="Attach image"
          title="Attach image"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Textarea
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          placeholder="Ask about your budget...  (Shift+Enter for a new line)"
          disabled={isGenerating || disabled}
          rows={1}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
        />
        <VoiceInputButton disabled={isGenerating || disabled} />
        <Button onClick={onSend} disabled={!canSend || disabled} size="icon">
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
