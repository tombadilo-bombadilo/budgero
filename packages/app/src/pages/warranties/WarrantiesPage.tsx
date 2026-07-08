import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asMilli, fromDecimal, toDecimal, ZERO_MILLI } from '@budgero/core/browser';
import { format, parseISO } from 'date-fns';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/ui/dialog';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { toast } from 'sonner';
import { ShieldCheck, Plus } from 'lucide-react';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useWarranties,
  useCreateWarranty,
  useUpdateWarranty,
  useDeleteWarranty,
} from '@entities/warranty/api/useWarranties';
import { useAllTransactions } from '@entities/transaction/api/useTransactions';
import { compressReceiptImage, receiptBlobToUrl } from '@shared/lib/image-compression';
import { useReceiptCamera } from '@features/ai/ui/receipt-scanner/useReceiptCamera';
import {
  isValidImageFile,
  createImagePreview,
} from '@features/ai/ui/receipt-scanner/receipt-scanner.utils';
import type { Warranty } from '@budgero/core/browser';
import {
  getStatus,
  WarrantyTable,
  WarrantyCard,
  WarrantyFormDialog,
  type FormState,
} from './components';

/** One-line transaction label: "date · payee · category · memo (±amount)". */
function formatTxLabel(tx: {
  Date: string;
  Payee?: string | null;
  Category?: string | null;
  Memo?: string | null;
  Outflow: number;
  Inflow: number;
}): string {
  const parts = [tx.Date];
  if (tx.Payee) parts.push(tx.Payee);
  if (tx.Category) parts.push(tx.Category);
  if (tx.Memo) parts.push(tx.Memo);
  // Stored amounts are milliunits; the label shows decimal currency units.
  const amount =
    tx.Outflow > 0
      ? `-${toDecimal(asMilli(tx.Outflow))}`
      : tx.Inflow > 0
        ? `+${toDecimal(asMilli(tx.Inflow))}`
        : '';
  return amount ? `${parts.join(' · ')} (${amount})` : parts.join(' · ');
}

const emptyForm: FormState = {
  name: '',
  expiresAt: '',
  amount: '',
  transactionId: '',
  notes: '',
  receiptFile: null,
  existingReceipt: null,
};

export default function WarrantiesPage() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const currencyCode = selectedBudget?.DisplayCurrency || 'USD';

  const { data: warranties = [], isLoading } = useWarranties(budgetId);
  const { data: allTransactions = [] } = useAllTransactions(budgetId);
  const createWarranty = useCreateWarranty();
  const updateWarranty = useUpdateWarranty();
  const deleteWarranty = useDeleteWarranty();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWarranty, setEditingWarranty] = useState<Warranty | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Warranty | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Uint8Array | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [txComboboxOpen, setTxComboboxOpen] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    };
  }, [receiptPreviewUrl]);

  const recentTransactions = useMemo(() => {
    return [...allTransactions].sort((a, b) => b.Date.localeCompare(a.Date)).slice(0, 200);
  }, [allTransactions]);

  const selectedTxLabel = useMemo(() => {
    if (!form.transactionId) return '';
    const tx = allTransactions.find((t) => t.ID === Number(form.transactionId));
    return tx ? formatTxLabel(tx) : '';
  }, [form.transactionId, allTransactions]);

  const statusCounts = useMemo(() => {
    const counts = { active: 0, expiring: 0, expired: 0 };
    for (const w of warranties) {
      counts[getStatus(w.ExpiresAt)]++;
    }
    return counts;
  }, [warranties]);

  const openCreate = useCallback(() => {
    setEditingWarranty(null);
    setForm(emptyForm);
    setReceiptPreviewUrl(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((w: Warranty) => {
    setEditingWarranty(w);
    setForm({
      name: w.Name,
      expiresAt: w.ExpiresAt,
      // Form amount is a decimal string; stored Amount is milliunits.
      amount: w.Amount ? String(toDecimal(w.Amount)) : '',
      transactionId: w.TransactionID != null ? String(w.TransactionID) : '',
      notes: w.Notes,
      receiptFile: null,
      existingReceipt: w.ReceiptImage ?? null,
    });
    if (w.ReceiptImage) {
      const url = receiptBlobToUrl(w.ReceiptImage);
      setReceiptPreviewUrl(url);
    } else {
      setReceiptPreviewUrl(null);
    }
    setDialogOpen(true);
  }, []);

  const setReceiptFromFile = useCallback(
    async (file: File) => {
      setForm((prev) => ({ ...prev, receiptFile: file, existingReceipt: null }));
      if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
      const preview = await createImagePreview(file);
      setReceiptPreviewUrl(preview);
    },
    [receiptPreviewUrl]
  );

  const camera = useReceiptCamera(setReceiptFromFile);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !isValidImageFile(file)) return;
      await setReceiptFromFile(file);
    },
    [setReceiptFromFile]
  );

  const handleReceiptDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file || !isValidImageFile(file)) {
        toast.error('Please drop an image file');
        return;
      }
      await setReceiptFromFile(file);
    },
    [setReceiptFromFile]
  );

  const handleReceiptDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleRemoveReceipt = useCallback(() => {
    setForm((prev) => ({ ...prev, receiptFile: null, existingReceipt: null }));
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    setReceiptPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [receiptPreviewUrl]);

  const handleDateSelect = useCallback((date: Date | undefined) => {
    if (date) {
      setForm((p) => ({ ...p, expiresAt: format(date, 'yyyy-MM-dd') }));
    }
    setDatePickerOpen(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim() || !form.expiresAt) {
      toast.error('Name and expiry date are required');
      return;
    }
    setSubmitting(true);
    try {
      let receiptImage: Uint8Array | null | undefined;
      if (form.receiptFile) {
        receiptImage = await compressReceiptImage(form.receiptFile);
      } else if (form.existingReceipt) {
        receiptImage = undefined; // don't update
      } else if (editingWarranty?.ReceiptImage) {
        receiptImage = null; // clear receipt
      }

      const transactionId = form.transactionId ? Number(form.transactionId) : null;
      const amount = form.amount ? fromDecimal(parseFloat(form.amount)) : ZERO_MILLI;

      if (editingWarranty) {
        await updateWarranty.mutateAsync({
          id: editingWarranty.ID,
          budgetId,
          name: form.name.trim(),
          expiresAt: form.expiresAt,
          amount,
          transactionId,
          notes: form.notes,
          ...(receiptImage !== undefined ? { receiptImage } : {}),
        });
        toast.success('Warranty updated');
      } else {
        await createWarranty.mutateAsync({
          budgetId,
          name: form.name.trim(),
          expiresAt: form.expiresAt,
          amount,
          transactionId,
          notes: form.notes,
          receiptImage: receiptImage ?? null,
        });
        toast.success('Warranty created');
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error('Failed to save warranty');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }, [form, editingWarranty, budgetId, createWarranty, updateWarranty]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteWarranty.mutateAsync({ id: deleteTarget.ID, budgetId });
      toast.success('Warranty deleted');
    } catch {
      toast.error('Failed to delete warranty');
    }
    setDeleteTarget(null);
  }, [deleteTarget, budgetId, deleteWarranty]);

  const transactionLabel = useCallback(
    (transactionId: number | null) => {
      if (transactionId == null) return '—';
      const tx = allTransactions.find((t) => t.ID === transactionId);
      return tx ? formatTxLabel(tx) : `#${transactionId}`;
    },
    [allTransactions]
  );

  const toggleNotes = useCallback((id: number) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  useEffect(() => {
    if (viewingReceipt) {
      const url = receiptBlobToUrl(viewingReceipt);
      setViewerUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setViewerUrl(null);
  }, [viewingReceipt]);

  const expiresAtDate = form.expiresAt ? parseISO(form.expiresAt) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading warranties...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 pb-24 md:p-6 md:pb-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Warranties</h1>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Add Warranty
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold">{statusCounts.active}</p>
            <p className="text-sm text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{statusCounts.expiring}</p>
            <p className="text-sm text-muted-foreground">Expiring Soon</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold text-destructive">{statusCounts.expired}</p>
            <p className="text-sm text-muted-foreground">Expired</p>
          </CardContent>
        </Card>
      </div>

      {/* Empty state */}
      {warranties.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No warranties yet. Add one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <WarrantyTable
            warranties={warranties}
            currencyCode={currencyCode}
            expandedNotes={expandedNotes}
            onToggleNotes={toggleNotes}
            transactionLabel={transactionLabel}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            onViewReceipt={setViewingReceipt}
          />

          {/* Mobile card list */}
          <div className="flex flex-col gap-3 md:hidden">
            {warranties.map((w) => (
              <WarrantyCard
                key={w.ID}
                warranty={w}
                currencyCode={currencyCode}
                notesExpanded={expandedNotes.has(w.ID)}
                onToggleNotes={toggleNotes}
                transactionLabel={transactionLabel}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
                onViewReceipt={setViewingReceipt}
              />
            ))}
          </div>
        </>
      )}

      {/* Add/Edit Dialog */}
      <WarrantyFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingWarranty={editingWarranty}
        form={form}
        setForm={setForm}
        submitting={submitting}
        onSubmit={handleSubmit}
        expiresAtDate={expiresAtDate}
        datePickerOpen={datePickerOpen}
        setDatePickerOpen={setDatePickerOpen}
        onDateSelect={handleDateSelect}
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        receiptPreviewUrl={receiptPreviewUrl}
        onRemoveReceipt={handleRemoveReceipt}
        onReceiptDrop={handleReceiptDrop}
        onReceiptDragOver={handleReceiptDragOver}
        cameraActive={camera.cameraActive}
        videoRef={camera.videoRef}
        canvasRef={camera.canvasRef}
        onStartCamera={camera.startCamera}
        onStopCamera={camera.stopCamera}
        onCapturePhoto={camera.capturePhoto}
        txComboboxOpen={txComboboxOpen}
        setTxComboboxOpen={setTxComboboxOpen}
        selectedTxLabel={selectedTxLabel}
        recentTransactions={recentTransactions}
        formatTxLabel={formatTxLabel}
      />

      {/* Receipt Viewer Dialog */}
      <Dialog open={!!viewingReceipt} onOpenChange={(open) => !open && setViewingReceipt(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>
          {viewerUrl && <img src={viewerUrl} alt="Receipt" className="w-full rounded" />}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Warranty"
        description={
          <>Are you sure you want to delete "{deleteTarget?.Name}"? This action cannot be undone.</>
        }
        confirmText="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}
