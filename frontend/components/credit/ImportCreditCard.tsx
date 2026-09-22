'use client';

import React from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/Button';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { useSandbox } from '@/lib/context/SandboxContext';
import { DownloadCloud } from 'lucide-react';

/** Public Aave V3 borrower on Arbitrum One used for the labeled demo import. */
const DEMO_AAVE_BORROWER = '0x699e74955b470C24f9a80ce60Ce0a8FFa747b897';

/**
 * Portable credit: bootstrap an ArbiScore profile from existing Aave V3 history on Arbitrum One.
 * The API indexes the history and signs an EIP-712 attestation; CreditImporter verifies it and
 * writes the loans into the Stylus engine. Only wallets without ArbiScore history can import.
 */
export function ImportCreditCard() {
  const { isConnected } = useAccount();
  const { isLiveMode, liveStatus } = useSandbox();
  const { importAaveCredit, txStatus } = useCreditVaultTx();
  if (!isConnected || !isLiveMode) return null;

  const busy = txStatus.step !== 'idle' && txStatus.step !== 'confirmed' && txStatus.step !== 'failed';

  return (
    <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
          <DownloadCloud className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">Portable credit: bring your Aave history</div>
          <p className="text-[11px] font-mono text-zinc-400 max-w-2xl mt-0.5">
            {liveStatus.hasHistory
              ? 'This wallet already has an ArbiScore history. Imports can only bootstrap new wallets, so existing records (including liquidations) can never be overwritten.'
              : 'Skip the cold start: closed Aave V3 loans on Arbitrum One (held 14+ days) are indexed, signed as an EIP-712 attestation and verified on-chain by CreditImporter before the Stylus engine scores them.'}
          </p>
        </div>
      </div>
      {!liveStatus.hasHistory && (
        <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => importAaveCredit()} className="font-mono text-xs">
            Import my Aave history
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => importAaveCredit(DEMO_AAVE_BORROWER)}
            className="font-mono text-xs"
            title={`Testnet demo: imports the public history of ${DEMO_AAVE_BORROWER}; the attestation's source field records this on-chain`}
          >
            Demo: import a public Aave borrower
          </Button>
        </div>
      )}
    </div>
  );
}
