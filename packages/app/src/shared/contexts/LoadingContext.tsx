/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, ReactNode } from 'react';
import { LoadingOverlay } from '@shared/ui/loading-overlay';
import { useRequiredContext } from '@shared/lib/useRequiredContext';

interface LoadingContextType {
  showTransferLoading: () => void;
  hideTransferLoading: () => void;
  isProcessingTransfer: boolean;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);

  const showTransferLoading = () => setIsLoading(true);
  const hideTransferLoading = () => setIsLoading(false);

  return (
    <LoadingContext.Provider
      value={{
        showTransferLoading,
        hideTransferLoading,
        isProcessingTransfer: isLoading,
      }}
    >
      {children}
      <LoadingOverlay show={isLoading} />
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  return useRequiredContext(LoadingContext, 'Loading');
}
