/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react';
import type { SameDayTransactionOrder } from '@budgero/core/browser';

export interface RegisterDisplay {
  /** Denser register rows (Appearance setting). */
  compactRows: boolean;
  /** Order of transactions that share a date. */
  sameDayOrder: SameDayTransactionOrder;
  /** Show each transaction's time of day next to its date (and order a day by it). */
  showTime: boolean;
}

const RegisterDisplayContext = createContext<RegisterDisplay>({
  compactRows: false,
  sameDayOrder: 'newest',
  showTime: false,
});

export function RegisterDisplayProvider({
  value,
  children,
}: {
  value: RegisterDisplay;
  children: ReactNode;
}) {
  return (
    <RegisterDisplayContext.Provider value={value}>{children}</RegisterDisplayContext.Provider>
  );
}

export function useRegisterDisplay(): RegisterDisplay {
  return useContext(RegisterDisplayContext);
}
