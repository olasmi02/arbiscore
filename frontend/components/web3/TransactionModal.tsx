'use client';

import React from 'react';
import { TxStatusState } from '@/hooks/useCreditVaultTx';
import { CheckCircle2, XCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface TransactionModalProps {
  status: TxStatusState;
  onClose: () => void;
}

export function TransactionModal({ status, onClose }: TransactionModalProps) {
  if (status.step === 'idle') return null;

  const isPending =
    status.step === 'signing_approval' ||
    status.step === 'pending_approval' ||
    status.step === 'signing_action' ||
    status.step === 'pending_action';

  const isConfirmed = status.step === 'confirmed';
  const isFailed = status.step === 'failed';

  const targetTxHash = status.txHash || status.approvalHash;
  const explorerUrl = targetTxHash ? `https://sepolia.arbiscan.io/tx/${targetTxHash}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl relative">
        <div className="flex flex-col items-center text-center">
          {/* Status Icon */}
          {isPending && (
            <div className="w-16 h-16 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-4 relative">
              <span className="absolute inset-0 rounded-full bg-sky-400/20 animate-ping" />
              <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
            </div>
          )}

          {isConfirmed && (
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
          )}

          {isFailed && (
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
              <XCircle className="w-8 h-8 text-rose-400" />
            </div>
          )}

          {/* Title & Description */}
          <h3 className="text-lg font-semibold text-white tracking-tight mb-1">
            {status.actionTitle}
          </h3>

          <p className="text-xs text-zinc-400 mb-6 font-mono max-w-xs">
            {status.step === 'signing_approval' && 'Please sign the ERC-20 approval in your wallet...'}
            {status.step === 'pending_approval' && 'Broadcasting token approval to Arbitrum Sepolia...'}
            {status.step === 'signing_action' && 'Please sign the transaction in your wallet...'}
            {status.step === 'pending_action' && 'Awaiting block confirmation on Arbitrum Sepolia...'}
            {status.step === 'confirmed' && 'Transaction finalized and verified on Arbitrum Sepolia!'}
            {status.step === 'failed' && (status.errorMessage || 'Transaction execution was rejected or failed')}
          </p>

          {/* Arbiscan Block Explorer Verification Link */}
          {targetTxHash && (
            <div className="w-full p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between mb-6">
              <div className="text-left font-mono">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Tx Hash</div>
                <div className="text-xs text-zinc-300">
                  {targetTxHash.slice(0, 8)}...{targetTxHash.slice(-6)}
                </div>
              </div>
              <a
                href={explorerUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-200 transition-colors border border-zinc-700"
              >
                Arbiscan <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Dismiss / Action Button */}
          {(isConfirmed || isFailed) && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={onClose}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
