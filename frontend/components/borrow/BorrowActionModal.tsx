'use client';

import { useMarket } from '@/lib/context/MarketContext';
import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { BorrowQuote } from '@/lib/types';
import { useSandbox } from '@/lib/context/SandboxContext';
import { useAccount } from 'wagmi';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { Shield, ArrowRight, CheckCircle, AlertCircle } from 'lucide-react';

interface BorrowActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote: BorrowQuote;
}

export function BorrowActionModal({ isOpen, onClose, quote }: BorrowActionModalProps) {
  const { isSandboxMode, borrowSimulationLoan, collateralState } = useSandbox();
  const { isConnected } = useAccount();
  const { market: mkt } = useMarket();
  const { borrow, txStatus } = useCreditVaultTx(() => {
    onClose();
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Same rule as the vault: the loan's collateral must come from free (unlocked) WETH
  const hasEnoughCollateral = collateralState.freeETH >= quote.requiredCollateralETH;

  const handleExecuteBorrow = async () => {
    if (isSandboxMode || !isConnected) {
      setIsSubmitting(true);
      setTimeout(() => {
        borrowSimulationLoan(quote.borrowAmountUSD, quote.requiredCollateralETH);
        setIsSubmitting(false);
        onClose();
      }, 500);
    } else {
      await borrow(quote.borrowAmountUSD.toString());
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Originate ${mkt.label} Loan`}
      description="Review on-chain credit terms and execute borrow via ArbiCreditVault"
    >
      <div className="space-y-5">
        {/* Terms Breakdown Table */}
        <div className="rounded-xl bg-zinc-950 border border-zinc-800 divide-y divide-zinc-800/80 font-mono text-xs">
          <div className="p-3 flex items-center justify-between">
            <span className="text-zinc-400">Borrow Amount</span>
            <span className="text-white font-bold text-sm tabular-nums">
              ${quote.borrowAmountUSD.toLocaleString()} {mkt.symbol}
            </span>
          </div>

          <div className="p-3 flex items-center justify-between">
            <span className="text-zinc-400">Assigned Risk Tier</span>
            <span className="text-emerald-400 font-semibold">
              {quote.tierName} ({quote.requiredRatioPercent}% Ratio)
            </span>
          </div>

          <div className="p-3 flex items-center justify-between">
            <span className="text-zinc-400">Required Collateral (ETH)</span>
            <span className="text-white font-bold tabular-nums">
              {quote.requiredCollateralETH.toFixed(4)} ETH
            </span>
          </div>

          {quote.aprPercent !== undefined && (
            <div className="p-3 flex items-center justify-between">
              <span className="text-zinc-400">Fixed APR (30-day term)</span>
              <span className="text-white font-bold tabular-nums">{quote.aprPercent.toFixed(2)}%</span>
            </div>
          )}

          {quote.liqThresholdPercent !== undefined && (
            <div className="p-3 flex items-center justify-between">
              <span className="text-zinc-400">Liquidation Threshold</span>
              <span className="text-zinc-300 tabular-nums">below {quote.liqThresholdPercent}% collateral / debt</span>
            </div>
          )}

          <div className="p-3 flex items-center justify-between">
            <span className="text-zinc-400">Traditional DeFi Baseline (150%)</span>
            <span className="text-zinc-500 tabular-nums">
              {quote.traditionalCollateralETH.toFixed(4)} ETH
            </span>
          </div>

          <div className="p-3 flex items-center justify-between bg-emerald-500/5">
            <span className="text-emerald-300 font-semibold">Capital Unleashed</span>
            <span className="text-emerald-400 font-bold tabular-nums">
              {quote.collateralSavedUSDFormatted} ({quote.collateralSavedETH.toFixed(4)} ETH)
            </span>
          </div>
        </div>

        {/* Mode Indicator Note */}
        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2.5">
          <Shield className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-0.5" />
          <div>
            {isSandboxMode || !isConnected ? (
              <span>
                <strong className="text-white">Sandbox Mode Active:</strong> This borrow will execute
                instantly in the simulation engine, allocating a simulated loan and updating your
                dashboard metrics in real-time.
              </span>
            ) : (
              <span>
                <strong className="text-white">Live Arbitrum Sepolia:</strong> This transaction will
                interact directly with the deployed <code className="text-zinc-200">ArbiCreditVault</code> contract
                and record on-chain debt.
              </span>
            )}
          </div>
        </div>

        {!hasEnoughCollateral && (
          <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
            Not enough free collateral: this loan needs {quote.requiredCollateralETH.toFixed(4)} WETH at your tier
            and you have {collateralState.freeETH.toFixed(4)} WETH free. Deposit more WETH or borrow less.
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="outline" size="md" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleExecuteBorrow}
            disabled={!hasEnoughCollateral}
            isLoading={
              isSubmitting ||
              txStatus.step === 'signing_action' ||
              txStatus.step === 'pending_action'
            }
            rightIcon={<ArrowRight className="w-4 h-4" />}
            className="font-mono font-semibold"
          >
            Confirm & Borrow ${quote.borrowAmountUSD.toLocaleString()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
