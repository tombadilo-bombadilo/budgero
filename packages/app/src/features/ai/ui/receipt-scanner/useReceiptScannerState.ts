import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useCategories } from '@entities/category/api/useCategories';
import { useAddTransaction } from '@entities/transaction/api/useTransactions';
import { useLLMSettings } from '@features/ai/api/useLLMSettings';
import { extractTransactionsFromImage, type AIClientConfig } from '@features/ai/lib/client';
import { fromDecimal, ZERO_MILLI } from '@shared/lib/currency/milli';
import { getErrorMessage } from '@shared/lib/errors';
import {
  type ScanStep,
  type ExtractedTransaction,
  createCategoryNameMap,
  mapExtractedTransactions,
  fileToBase64,
  createImagePreview,
  isValidImageFile,
} from './receipt-scanner.utils';
import { useReceiptCamera } from './useReceiptCamera';

interface UseReceiptScannerStateProps {
  budgetId: number;
  defaultAccountId?: number;
  onOpenChange: (open: boolean) => void;
}

export function useReceiptScannerState({
  budgetId,
  defaultAccountId,
  onOpenChange,
}: UseReceiptScannerStateProps) {
  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: categories = [] } = useCategories(budgetId);
  const { data: llmSettings } = useLLMSettings(budgetId);
  const addTransaction = useAddTransaction();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<ScanStep>('upload');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extractedTransactions, setExtractedTransactions] = useState<ExtractedTransaction[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(defaultAccountId || 0);
  const [progress, setProgress] = useState(0);
  const [confidence, setConfidence] = useState(0);

  const camera = useReceiptCamera(async (file) => {
    setImageFile(file);
    const preview = await createImagePreview(file);
    setImagePreview(preview);
    setStep('upload');
  });

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isValidImageFile(file)) {
      toast.error('Please select an image file');
      return;
    }

    setImageFile(file);
    const preview = await createImagePreview(file);
    setImagePreview(preview);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    if (!isValidImageFile(file)) {
      toast.error('Please drop an image file');
      return;
    }

    setImageFile(file);
    const preview = await createImagePreview(file);
    setImagePreview(preview);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleScan = async () => {
    if (!imageFile || !llmSettings?.Enabled) return;

    setStep('scanning');
    setProgress(0);

    try {
      const config: AIClientConfig = {
        provider: llmSettings.Provider,
        endpointURL: llmSettings.EndpointURL,
        apiKey: llmSettings.ApiKey,
        textModel: llmSettings.TextModel,
        visionModel: llmSettings.VisionModel,
      };

      const base64 = await fileToBase64(imageFile);
      setProgress(30);

      const categoryNames = categories.map((c) => c.Name);
      const result = await extractTransactionsFromImage(
        config,
        base64,
        imageFile.type,
        categoryNames
      );

      setProgress(100);
      setConfidence(result.confidence);

      if (result.transactions.length === 0) {
        toast.warning('No transactions found', {
          description: 'Could not extract any transactions from this image.',
        });
        setStep('upload');
        return;
      }

      const categoryByName = createCategoryNameMap(categories);
      const transactions = mapExtractedTransactions(result, categoryByName);

      setExtractedTransactions(transactions);
      setStep('review');
    } catch (err) {
      console.error('Receipt scanning failed:', err);
      const message = getErrorMessage(err, 'Failed to scan receipt');
      setStep('upload');
      toast.error('Scanning failed', { description: message });
    }
  };

  const handleToggleSelect = (id: string) => {
    setExtractedTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t))
    );
  };

  const handleUpdateTransaction = (id: string, field: string, value: unknown) => {
    setExtractedTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const handleImport = async () => {
    const toImport = extractedTransactions.filter((t) => t.selected);

    if (toImport.length === 0) {
      toast.info('No transactions selected');
      return;
    }

    if (!selectedAccountId) {
      toast.error('Please select an account');
      return;
    }

    setStep('importing');
    setProgress(0);

    try {
      for (let i = 0; i < toImport.length; i++) {
        const t = toImport[i];
        setProgress(Math.round((i / toImport.length) * 100));

        await addTransaction.mutateAsync({
          accountId: selectedAccountId,
          budgetId,
          date: t.date,
          memo: t.memo || t.payee,
          payee: t.payee,
          categoryId: t.categoryId || 0,
          // Extracted amounts are LLM-facing decimals; the mutation carries milliunits
          inflow: t.isExpense ? ZERO_MILLI : fromDecimal(t.amount),
          outflow: t.isExpense ? fromDecimal(t.amount) : ZERO_MILLI,
          transferId: '',
        });
      }

      setProgress(100);
      setStep('done');
      toast.success(`Imported ${toImport.length} transactions`);
    } catch (err) {
      console.error('Failed to import transactions:', err);
      const message = getErrorMessage(err, 'Failed to import transactions');
      toast.error('Import failed', { description: message });
    }
  };

  const handleClose = () => {
    camera.stopCamera();
    setStep('upload');
    setImageFile(null);
    setImagePreview(null);
    setExtractedTransactions([]);
    setProgress(0);
    setConfidence(0);
    onOpenChange(false);
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startCamera = async () => {
    const started = await camera.startCamera();
    if (started) setStep('camera');
  };

  const cancelCamera = () => {
    camera.stopCamera();
    setStep('upload');
  };

  const goBackToUpload = () => {
    setStep('upload');
  };

  const selectedCount = extractedTransactions.filter((t) => t.selected).length;
  const isAIEnabled = !!llmSettings?.Enabled;
  const canScan = isAIEnabled && !!imageFile && !!selectedAccountId;

  return {
    fileInputRef,
    videoRef: camera.videoRef,
    canvasRef: camera.canvasRef,

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
    capturePhoto: camera.capturePhoto,
    cancelCamera,
    goBackToUpload,
  };
}
