'use client';

import React, { useState } from 'react';
import { useSandbox } from '@/lib/context/SandboxContext';
import { useAccount } from 'wagmi';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Coins, Plus, Minus, Lock, Unlock, Database } from 'lucide-react';

export function CollateralCard() {
  const { isSandboxMode, collateralState, depositSimulationCollateral, withdrawSimulationCollateral } =
    useSandbox();
  const { isConnected } = useAccount();
  const { depositCollateral, withdrawFreeCollateral, txStatus } = useCreditVaultTx();

  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('1.0');

  const handleDeposit = async () => {
    const val = parseFloat(depositAmount);
    if (isNaN(val) || val <= 0) return;

    if (isSandboxMode || !isConnected) {
      depositSimulationCollateral(val);
      setIsDepositOpen(false);
    } else {
      await depositCollateral(depositAmount);
      setIsDepositOpen(false);
    }
  };

  const handleWithdrawFree = async () => {
    if (collateralState.freeETH <= 0) return;
    if (isSandboxMode || !isConnected) {
      withdrawSimulationCollateral(collateralState.freeETH);
    } else {
      await withdrawFreeCollateral();
    }
  };

  return (
    <>
      <div className="p-5 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono uppercase tracking-wider text-zinc-300 font-semibold">
              Collateral Escrow Vault
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsDepositOpen(true)}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
              className="font-mono text-xs"
            >
              Deposit WETH
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleWithdrawFree}
              disabled={collateralState.freeETH <= 0}
              leftIcon={<Minus className="w-3.5 h-3.5" />}
              className="font-mono text-xs"
            >
              Withdraw Free
            </Button>
          </div>
        </div>

        {/* Metric Triplet */}
        <div className="grid grid-cols-3 gap-3">
          {/* Total Deposited */}
          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
              Total Deposited
            </div>
            <div className="text-lg font-bold text-white font-mono tabular-nums">
              {collateralState.depositedETH.toFixed(4)} ETH
            </div>
            <div className="text-[11px] font-mono text-zinc-400 tabular-nums mt-0.5">
              ${(collateralState.depositedETH * 3000).toLocaleString()} USD
            </div>
          </div>

          {/* Locked Collateral */}
          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
              <Lock className="w-3 h-3 text-amber-400" />
              <span>Locked</span>
            </div>
            <div className="text-lg font-bold text-amber-300 font-mono tabular-nums">
              {collateralState.lockedETH.toFixed(4)} ETH
            </div>
            <div className="text-[11px] font-mono text-zinc-400 tabular-nums mt-0.5">
              ${(collateralState.lockedETH * 3000).toLocaleString()} USD
            </div>
          </div>

          {/* Free Collateral */}
          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
              <Unlock className="w-3 h-3 text-emerald-400" />
              <span>Available Free</span>
            </div>
            <div className="text-lg font-bold text-emerald-400 font-mono tabular-nums">
              {collateralState.freeETH.toFixed(4)} ETH
            </div>
            <div className="text-[11px] font-mono text-zinc-400 tabular-nums mt-0.5">
              ${(collateralState.freeETH * 3000).toLocaleString()} USD
            </div>
          </div>
        </div>
      </div>

      {/* Deposit Modal */}
      <Modal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        title="Deposit WETH Collateral"
        description="Lock WETH into ArbiCreditVault escrow to support dynamic borrowing"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              Deposit Amount (ETH)
            </label>
            <div className="mt-1.5 relative">
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white font-mono text-lg font-bold tabular-nums focus:outline-none focus:border-zinc-600"
              />
              <span className="absolute right-3.5 top-3 text-xs font-mono text-zinc-500">
                WETH
              </span>
            </div>
            <div className="mt-1 text-[11px] font-mono text-zinc-500">
              Equivalent: ${(parseFloat(depositAmount || '0') * 3000).toLocaleString()} USD
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsDepositOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDeposit}
              isLoading={txStatus.step === 'signing_approval' || txStatus.step === 'pending_action'}
              className="font-mono"
            >
              Confirm Deposit
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
