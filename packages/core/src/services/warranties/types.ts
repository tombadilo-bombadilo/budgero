/**
 * Warranty service type definitions
 */

import type { MilliUnits } from '../../money/index.js';

export interface Warranty {
  ID: number;
  BudgetID: number;
  Name: string;
  ExpiresAt: string; // YYYY-MM-DD
  TransactionID: number | null;
  ReceiptImage: Uint8Array | null;
  Notes: string;
  Amount: MilliUnits;
  CreatedAt: string;
}

export interface CreateWarrantyInput {
  budgetId: number;
  name: string;
  expiresAt: string; // YYYY-MM-DD
  amount?: MilliUnits;
  transactionId?: number | null;
  receiptImage?: Uint8Array | null;
  notes?: string;
}

export interface UpdateWarrantyInput {
  id: number;
  name?: string;
  expiresAt?: string;
  amount?: MilliUnits;
  transactionId?: number | null;
  receiptImage?: Uint8Array | null;
  notes?: string;
}
