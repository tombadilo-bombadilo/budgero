/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react';

const InlineTransactionEntryContext = createContext(false);

export function InlineTransactionEntryProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <InlineTransactionEntryContext.Provider value={enabled}>
      {children}
    </InlineTransactionEntryContext.Provider>
  );
}

/** Whether the desktop register adds transactions inline (Appearance setting). */
export function useInlineTransactionEntryEnabled(): boolean {
  return useContext(InlineTransactionEntryContext);
}
