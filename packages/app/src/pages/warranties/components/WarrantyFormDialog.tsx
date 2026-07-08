import type React from 'react';
import { useId } from 'react';
import { format } from 'date-fns';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@shared/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';
import { Textarea } from '@shared/ui/textarea';
import { Calendar as CalendarIcon, Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { ReceiptDropzone } from '@features/ai/ui/receipt-scanner/ReceiptDropzone';
import { ReceiptPreview } from '@features/ai/ui/receipt-scanner/ReceiptPreview';
import { CameraActions } from '@features/ai/ui/receipt-scanner/ScanActions';
import { toDecimal } from '@budgero/core/browser';
import type { GetAllTransactions, Warranty } from '@budgero/core/browser';

export interface FormState {
  name: string;
  expiresAt: string;
  amount: string;
  transactionId: string; // '' = none
  notes: string;
  receiptFile: File | null;
  existingReceipt: Uint8Array | null;
}

interface WarrantyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingWarranty: Warranty | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  submitting: boolean;
  onSubmit: () => void;

  expiresAtDate: Date | null;
  datePickerOpen: boolean;
  setDatePickerOpen: (open: boolean) => void;
  onDateSelect: (date: Date | undefined) => void;

  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  receiptPreviewUrl: string | null;
  onRemoveReceipt: () => void;
  onReceiptDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onReceiptDragOver: (e: React.DragEvent<HTMLDivElement>) => void;

  cameraActive: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onCapturePhoto: () => void;

  txComboboxOpen: boolean;
  setTxComboboxOpen: (open: boolean) => void;
  selectedTxLabel: string;
  recentTransactions: GetAllTransactions[];
  formatTxLabel: (tx: GetAllTransactions) => string;
}

/** Add/edit dialog for a warranty (matches the accounts convention). */
export function WarrantyFormDialog({
  open,
  onOpenChange,
  editingWarranty,
  form,
  setForm,
  submitting,
  onSubmit,
  expiresAtDate,
  datePickerOpen,
  setDatePickerOpen,
  onDateSelect,
  fileInputRef,
  onFileSelect,
  receiptPreviewUrl,
  onRemoveReceipt,
  onReceiptDrop,
  onReceiptDragOver,
  cameraActive,
  videoRef,
  canvasRef,
  onStartCamera,
  onStopCamera,
  onCapturePhoto,
  txComboboxOpen,
  setTxComboboxOpen,
  selectedTxLabel,
  recentTransactions,
  formatTxLabel,
}: WarrantyFormDialogProps) {
  const fieldIdBase = useId();
  const nameId = `${fieldIdBase}-name`;
  const expiryId = `${fieldIdBase}-expiry`;
  const amountId = `${fieldIdBase}-amount`;
  const transactionId = `${fieldIdBase}-transaction`;
  const notesId = `${fieldIdBase}-notes`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editingWarranty ? 'Edit Warranty' : 'Add Warranty'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2 overflow-y-auto flex-1 min-h-0">
          <div>
            <Label htmlFor={nameId} className="text-sm font-medium mb-1 block">
              Name *
            </Label>
            <Input
              id={nameId}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Laptop Warranty"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={expiryId} className="text-sm font-medium mb-1 block">
                Expiry Date *
              </Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id={expiryId}
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expiresAtDate ? format(expiresAtDate, 'PP') : 'Select'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start" modal>
                  <MonthYearCalendar
                    selected={expiresAtDate ?? undefined}
                    onSelect={onDateSelect}
                    defaultMonth={
                      expiresAtDate
                        ? new Date(expiresAtDate.getFullYear(), expiresAtDate.getMonth())
                        : new Date()
                    }
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label htmlFor={amountId} className="text-sm font-medium mb-1 block">
                Amount
              </Label>
              <Input
                id={amountId}
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            {/* Caption, not a <label>: the control below is a dropzone/camera composite. */}
            <span className="text-sm font-medium mb-1 block">Receipt Image</span>
            <canvas ref={canvasRef} className="hidden" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFileSelect}
              className="hidden"
            />
            {cameraActive ? (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full max-h-[300px] object-contain"
                  />
                </div>
                <CameraActions onCancel={onStopCamera} onCapture={onCapturePhoto} />
              </div>
            ) : receiptPreviewUrl ? (
              <ReceiptPreview
                imagePreview={receiptPreviewUrl}
                fileName={form.receiptFile?.name}
                onRemove={onRemoveReceipt}
              />
            ) : (
              <ReceiptDropzone
                onDrop={onReceiptDrop}
                onDragOver={onReceiptDragOver}
                onStartCamera={onStartCamera}
                onBrowseFiles={() => fileInputRef.current?.click()}
              />
            )}
          </div>
          <div>
            <Label htmlFor={transactionId} className="text-sm font-medium mb-1 block">
              Link to Transaction
            </Label>
            <Popover open={txComboboxOpen} onOpenChange={setTxComboboxOpen} modal>
              <PopoverTrigger asChild>
                <Button
                  id={transactionId}
                  variant="outline"
                  role="combobox"
                  aria-expanded={txComboboxOpen}
                  className={cn(
                    'w-full justify-between text-left font-normal',
                    !form.transactionId && 'text-muted-foreground'
                  )}
                >
                  <span className="truncate">{selectedTxLabel || 'None'}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command loop>
                  <CommandInput placeholder="Search transactions..." />
                  <CommandList>
                    <CommandEmpty>No transactions found.</CommandEmpty>
                    {form.transactionId && (
                      <CommandGroup heading="Actions">
                        <CommandItem
                          value="__clear__"
                          onSelect={() => {
                            setForm((p) => ({ ...p, transactionId: '' }));
                            setTxComboboxOpen(false);
                          }}
                        >
                          <X className="h-4 w-4 mr-2" />
                          Clear selection
                        </CommandItem>
                      </CommandGroup>
                    )}
                    <CommandGroup heading="Transactions">
                      {recentTransactions.map((tx) => {
                        const label = formatTxLabel(tx);
                        const isSelected = form.transactionId === String(tx.ID);
                        return (
                          <CommandItem
                            key={tx.ID}
                            value={label}
                            onSelect={() => {
                              const txAmount = tx.Outflow > 0 ? tx.Outflow : tx.Inflow;
                              setForm((p) => ({
                                ...p,
                                transactionId: String(tx.ID),
                                // Form amount is a decimal string; stored flows are milliunits.
                                amount: txAmount > 0 ? String(toDecimal(txAmount)) : p.amount,
                              }));
                              setTxComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'h-4 w-4 mr-2',
                                isSelected ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <span className="truncate">{label}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label htmlFor={notesId} className="text-sm font-medium mb-1 block">
              Notes
            </Label>
            <Textarea
              id={notesId}
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Optional notes about the warranty..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : editingWarranty ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
