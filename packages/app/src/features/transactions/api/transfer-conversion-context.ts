import * as React from 'react';

export interface TransferConversionActions {
  /** Turn a plain transaction into a transfer with `counterpartAccountId`. */
  requestConversion: (transactionId: number, counterpartAccountId: number) => void | Promise<void>;
  /** Turn a transfer row back into a plain transaction. */
  requestUnlink: (transactionId: number) => void | Promise<void>;
}

const TransferConversionContext = React.createContext<TransferConversionActions | null>(null);

/** Provided by the transactions table; surfaces outside it simply offer no transfer choices. */
export const TransferConversionProvider = TransferConversionContext.Provider;

export function useTransferConversionActions(): TransferConversionActions | null {
  return React.useContext(TransferConversionContext);
}
