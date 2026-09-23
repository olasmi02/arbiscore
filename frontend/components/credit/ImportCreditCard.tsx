'use client';

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/Button';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { useSandbox } from '@/lib/context/SandboxContext';
import { DownloadCloud } from 'lucide-react';

/**
 * Portable credit: bootstrap an ArbiScore profile from existing Aave V3 history on Arbitrum One.
 * The API indexes the history and signs an EIP-712 attestation; CreditImporter verifies it and
 * writes the loans into the Stylus engine. Only wallets without ArbiScore history can import.
 *
 * Anyone can import their OWN history. The two demo imports (a good and a liquidated public
 * borrower) need a judge access code or an allowlisted demo wallet; the server enforces this.
 */
export function ImportCreditCard() {
  const { isConnected } = useAccount();
  const { isLiveMode, liveStatus } = useSandbox();
  const { importAaveCredit, txStatus } = useCreditVaultTx();
  const [code, setCode] = useState('');
  if (!isConnected || !isLiveMode) return null;

  const busy = txStatus.step !== 'idle' && txStatus.step !== 'confirmed' && txStatus.step !== 'failed';

  return (
    <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
          <DownloadCloud className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">Portable credit: bring your Aave history</div>
          <p className="text-[11px] font-mono text-zinc-400 max-w-3xl mt-0.5">
            {liveStatus.hasHistory
              ? 'This wallet already has an ArbiScore history. Imports can only bootstrap new wallets, so existing records (including liquidations) can never be overwritten.'
              : 'Skip the cold start: your Aave V3 positions on Arbitrum One (repaid ones held 14+ days, and every liquidation) are indexed, signed as an EIP-712 attestation and verified on-chain by CreditImporter before the Stylus engine scores them.'}
          </p>
        </div>
      </div>

      {!liveStatus.hasHistory && (
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => importAaveCredit()} className="font-mono text-xs">
            Import my Aave history
          </Button>

          <div className="flex-1 flex flex-col sm:flex-row sm:items-end gap-2 lg:justify-end">
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Judge access code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="for demo imports"
                className="w-full sm:w-44 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-white normal-case tracking-normal focus:outline-none focus:border-zinc-600"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => importAaveCredit('good', code)}
              className="font-mono text-xs"
              title="Imports a real public Aave borrower with a clean repayment record (source recorded on-chain)"
            >
              Demo: good borrower
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => importAaveCredit('bad', code)}
              className="font-mono text-xs"
              title="Imports a real public Aave borrower who was liquidated (source recorded on-chain)"
            >
              Demo: liquidated borrower
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
