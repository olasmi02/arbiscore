'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';

export type TxLifecycleStep =
  | 'idle'
  | 'signing_approval'
  | 'pending_approval'
  | 'signing_action'
  | 'pending_action'
  | 'confirmed'
  | 'failed';

export interface TxStatusState {
  step: TxLifecycleStep;
  actionTitle: string;
  txHash?: `0x${string}`;
  approvalHash?: `0x${string}`;
  errorMessage?: string;
}

interface TxContextType {
  txStatus: TxStatusState;
  setTxStatus: (s: TxStatusState) => void;
  resetTx: () => void;
  /** Increments after every confirmed transaction so on-chain reads can refetch. */
  confirmedCount: number;
}

const TxContext = createContext<TxContextType | undefined>(undefined);

/** One transaction lifecycle shared app-wide, so the global TransactionModal sees every tx. */
export function TxProvider({ children }: { children: React.ReactNode }) {
  const [txStatus, setStatus] = useState<TxStatusState>({ step: 'idle', actionTitle: '' });
  const [confirmedCount, setConfirmedCount] = useState(0);

  const setTxStatus = useCallback((s: TxStatusState) => {
    setStatus(s);
    if (s.step === 'confirmed') setConfirmedCount((n) => n + 1);
  }, []);
  const resetTx = useCallback(() => setStatus({ step: 'idle', actionTitle: '' }), []);

  return (
    <TxContext.Provider value={{ txStatus, setTxStatus, resetTx, confirmedCount }}>{children}</TxContext.Provider>
  );
}

export function useTxContext() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error('useTxContext must be used within a TxProvider');
  return ctx;
}
