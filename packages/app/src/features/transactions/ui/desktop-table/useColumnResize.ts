import { useState, useCallback, useEffect } from 'react';

export interface ColumnWidths {
  checkbox: number;
  date: number;
  memo: number;
  account: number;
  payee: number;
  label: number;
  category: number;
  inflow: number;
  outflow: number;
  exchangeRate: number;
  balance: number;
  status: number;
}

const DEFAULT_WIDTHS: ColumnWidths = {
  checkbox: 40,
  date: 110,
  memo: 200,
  account: 140,
  payee: 140,
  label: 130,
  category: 180,
  inflow: 100,
  outflow: 100,
  exchangeRate: 90,
  balance: 110,
  status: 90,
};

const MIN_WIDTHS: ColumnWidths = {
  checkbox: 15,
  date: 35,
  memo: 100,
  account: 50,
  payee: 50,
  label: 70,
  category: 80,
  inflow: 70,
  outflow: 70,
  exchangeRate: 60,
  balance: 80,
  status: 70,
};

const STORAGE_KEY = 'transaction-table-column-widths';

export function useColumnResize(
  hideAccountColumn: boolean,
  showBalanceColumn = false,
  showExchangeRateColumn = false,
  showLabelColumn = true
) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_WIDTHS, ...parsed };
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_WIDTHS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // Ignore storage errors
    }
  }, [columnWidths]);

  const handleResize = useCallback((column: keyof ColumnWidths, delta: number) => {
    setColumnWidths((prev) => {
      const newWidth = Math.max(MIN_WIDTHS[column], prev[column] + delta);
      return { ...prev, [column]: newWidth };
    });
  }, []);

  // Calculate total width for table min-width
  const totalWidth =
    columnWidths.checkbox +
    columnWidths.date +
    columnWidths.memo +
    (hideAccountColumn ? 0 : columnWidths.account) +
    columnWidths.payee +
    (showLabelColumn ? columnWidths.label : 0) +
    columnWidths.category +
    columnWidths.inflow +
    columnWidths.outflow +
    (showExchangeRateColumn ? columnWidths.exchangeRate : 0) +
    (showBalanceColumn ? columnWidths.balance : 0) +
    columnWidths.status;

  return {
    columnWidths,
    handleResize,
    totalWidth,
  };
}
