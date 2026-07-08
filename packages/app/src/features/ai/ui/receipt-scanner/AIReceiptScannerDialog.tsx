import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ImagePlus } from 'lucide-react';
import { AINotConfiguredWarning } from '@features/ai/ui/AINotConfiguredWarning';
import { useReceiptScannerState } from './useReceiptScannerState';
import { ReceiptDropzone } from './ReceiptDropzone';
import { ReceiptPreview } from './ReceiptPreview';
import { ScanProgress, ScanComplete } from './ScanProgress';
import { LineItemsTable } from './LineItemsTable';
import { UploadActions, ReviewActions, CameraActions } from './ScanActions';

interface AIReceiptScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budgetId: number;
  defaultAccountId?: number;
}

export function AIReceiptScannerDialog({
  open,
  onOpenChange,
  budgetId,
  defaultAccountId,
}: AIReceiptScannerDialogProps) {
  // Destructure to avoid "Cannot access refs during render" - React Compiler
  // flags any property access on an object that contains refs
  const {
    fileInputRef,
    videoRef,
    canvasRef,
    step,
    imageFile,
    imagePreview,
    extractedTransactions,
    selectedAccountId,
    progress,
    confidence,
    selectedCount,
    isAIEnabled,
    canScan,
    accounts,
    setSelectedAccountId,
    handleFileSelect,
    handleDrop,
    handleDragOver,
    handleScan,
    handleToggleSelect,
    handleUpdateTransaction,
    handleImport,
    handleClose,
    handleRemoveImage,
    startCamera,
    capturePhoto,
    cancelCamera,
    goBackToUpload,
  } = useReceiptScannerState({
    budgetId,
    defaultAccountId,
    onOpenChange,
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            Receipt Scanner
          </DialogTitle>
          <DialogDescription>
            Upload a receipt or bank statement image to extract transactions
          </DialogDescription>
        </DialogHeader>

        {/* Hidden canvas for photo capture */}
        <canvas ref={canvasRef} className="hidden" />

        {step === 'camera' && (
          <div className="space-y-4 py-4">
            <div className="relative rounded-lg overflow-hidden bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-[400px] object-contain"
              />
            </div>
            <CameraActions onCancel={cancelCamera} onCapture={capturePhoto} />
          </div>
        )}

        {step === 'upload' && (
          <div className="space-y-4 py-4">
            {!isAIEnabled ? (
              <AINotConfiguredWarning
                description={
                  <>
                    Go to Settings &rarr; AI Assistant to configure your local LLM connection. Make
                    sure you have a vision model (like qwen3-vl-8b) available.
                  </>
                }
              />
            ) : (
              <>
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {!imagePreview ? (
                  <ReceiptDropzone
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onStartCamera={startCamera}
                    onBrowseFiles={() => fileInputRef.current?.click()}
                  />
                ) : (
                  <ReceiptPreview
                    imagePreview={imagePreview}
                    fileName={imageFile?.name}
                    onRemove={handleRemoveImage}
                  />
                )}

                <AccountSelector
                  accounts={accounts}
                  selectedAccountId={selectedAccountId}
                  onAccountChange={setSelectedAccountId}
                />
              </>
            )}

            <UploadActions canScan={canScan} onCancel={handleClose} onScan={handleScan} />
          </div>
        )}

        {step === 'scanning' && (
          <ScanProgress progress={progress} message="Analyzing image with vision AI..." />
        )}

        {step === 'review' && (
          <>
            <LineItemsTable
              budgetId={budgetId}
              transactions={extractedTransactions}
              confidence={confidence}
              onToggleSelect={handleToggleSelect}
              onUpdateTransaction={handleUpdateTransaction}
            />
            <ReviewActions
              selectedCount={selectedCount}
              onBack={goBackToUpload}
              onImport={handleImport}
            />
          </>
        )}

        {step === 'importing' && (
          <ScanProgress progress={progress} message="Importing transactions..." />
        )}

        {step === 'done' && <ScanComplete selectedCount={selectedCount} onClose={handleClose} />}
      </DialogContent>
    </Dialog>
  );
}

interface AccountSelectorProps {
  accounts: { ID: number; Name: string }[];
  selectedAccountId: number;
  onAccountChange: (accountId: number) => void;
}

function AccountSelector({ accounts, selectedAccountId, onAccountChange }: AccountSelectorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="account">Import to Account</Label>
      <Select value={String(selectedAccountId)} onValueChange={(v) => onAccountChange(Number(v))}>
        <SelectTrigger id="account">
          <SelectValue placeholder="Select account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.ID} value={String(account.ID)}>
              {account.Name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
