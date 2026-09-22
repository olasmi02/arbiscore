'use client';

import React from 'react';
import { useSandbox } from '@/lib/context/SandboxContext';
import { Button } from '@/components/ui/Button';
import { useAccount } from 'wagmi';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { ArrowUpRight, RotateCcw, AlertTriangle, CloudLightning, CheckCircle2, FastForward } from 'lucide-react';

export function ActionSimulator() {
  const {
    activePersona,
    simulateRepayment,
    simulateLiquidation,
    resetSimulation,
    advanceTime,
    simulationNotice,
  } = useSandbox();

  const { isConnected } = useAccount();
  const { syncPersonaOnChain, txStatus } = useCreditVaultTx();

  return (
    <div className="space-y-4">
      {/* Simulation Trigger Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Simulate Repayment */}
        <Button
          variant="secondary"
          size="md"
          onClick={simulateRepayment}
          leftIcon={<ArrowUpRight className="w-4 h-4 text-emerald-400" />}
          className="font-mono text-xs justify-start px-3.5 py-2.5 bg-zinc-900/90 border-zinc-800 hover:border-emerald-500/40 hover:bg-emerald-950/20 text-zinc-200"
        >
          <div className="text-left">
            <div className="font-semibold text-white">Simulate Repayment</div>
            <div className="text-[10px] text-emerald-400">Close open loan on time • Re-score</div>
          </div>
        </Button>

        {/* Simulate Liquidation */}
        <Button
          variant="secondary"
          size="md"
          onClick={simulateLiquidation}
          leftIcon={<AlertTriangle className="w-4 h-4 text-rose-400" />}
          className="font-mono text-xs justify-start px-3.5 py-2.5 bg-zinc-900/90 border-zinc-800 hover:border-rose-500/40 hover:bg-rose-950/20 text-zinc-200"
        >
          <div className="text-left">
            <div className="font-semibold text-white">Simulate Liquidation</div>
            <div className="text-[10px] text-rose-400">Close open loan as default • Re-score</div>
          </div>
        </Button>

        {/* Fast-forward time (shows seasoning + recency decay) */}
        <Button
          variant="secondary"
          size="md"
          onClick={() => advanceTime(15)}
          leftIcon={<FastForward className="w-4 h-4 text-sky-400" />}
          className="font-mono text-xs justify-start px-3.5 py-2.5 bg-zinc-900/90 border-zinc-800 hover:border-sky-500/40 hover:bg-sky-950/20 text-zinc-200"
        >
          <div className="text-left">
            <div className="font-semibold text-white">Fast-forward 15 days</div>
            <div className="text-[10px] text-sky-400">Loans season • old events fade</div>
          </div>
        </Button>

        {/* Reset Simulation */}
        <Button
          variant="outline"
          size="md"
          onClick={resetSimulation}
          leftIcon={<RotateCcw className="w-4 h-4 text-zinc-400" />}
          className="font-mono text-xs justify-start px-3.5 py-2.5 bg-zinc-900/40 border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200"
        >
          <div className="text-left">
            <div className="font-semibold text-zinc-300">Reset Archetype</div>
            <div className="text-[10px] text-zinc-500">Restore Base Parameters</div>
          </div>
        </Button>
      </div>

      {/* On-Chain Wallet Sync (visible if connected) */}
      {isConnected && (
        <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CloudLightning className="w-4 h-4 text-sky-400 flex-shrink-0" />
            <div className="text-xs font-mono text-zinc-300">
              Write <strong className="text-white">{activePersona.name}</strong>&apos;s loan history to your wallet in the Stylus engine (demo mode), then turn the sandbox off to see the live on-chain score.
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => syncPersonaOnChain(activePersona)}
            isLoading={
              txStatus.step === 'signing_action' || txStatus.step === 'pending_action'
            }
            className="font-mono text-xs flex-shrink-0"
          >
            Sync On-Chain
          </Button>
        </div>
      )}

      {/* Simulation Feedback Notice */}
      {simulationNotice && (
        <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-700/80 flex items-center gap-2.5 text-xs font-mono text-zinc-200 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{simulationNotice}</span>
        </div>
      )}
    </div>
  );
}
