'use client';

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useMarketStats } from '@/hooks/useOnChainBorrower';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { useSandbox } from '@/lib/context/SandboxContext';
import { USDG_FAUCET_URL } from '@/lib/web3/addresses';
import { Landmark, ExternalLink } from 'lucide-react';

const fmtUSD = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">{label}</div>
      <div className="text-sm font-bold text-white tabular-nums font-mono mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{hint}</div>}
    </div>
  );
}

/** Lender side of the market: supply Paxos USDG, earn borrowers' interest (ERC-4626 asUSDG shares). */
export function LendingPanel() {
  const { isConnected } = useAccount();
  const { data: market, isLoading } = useMarketStats();
  const { liveAccount } = useSandbox();
  const { supplyUSDG, withdrawAllUSDG, txStatus } = useCreditVaultTx();
  const [amount, setAmount] = useState('10');
  const busy = txStatus.step !== 'idle' && txStatus.step !== 'confirmed' && txStatus.step !== 'failed';

  return (
    <Card className="shadow-fintech">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            <Landmark className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">USDG Lending Pool</h2>
            <p className="text-[11px] text-zinc-400 font-mono">
              Supply Paxos USDG • earn the interest credit-scored borrowers pay • ERC-4626 asUSDG shares
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Total Supplied" value={market ? fmtUSD(market.totalAssetsUSD) : isLoading ? '…' : '—'} />
          <Stat label="Available to Borrow" value={market ? fmtUSD(market.cashUSD) : '…'} />
          <Stat label="Utilization" value={market ? fmtPct(market.utilization) : '…'} />
          <Stat label="Supply APY" value={market ? fmtPct(market.supplyApr) : '…'} hint="loan-weighted APR × utilization" />
        </div>

        {!isConnected ? (
          <p className="text-xs font-mono text-zinc-500">Connect a wallet on Arbitrum Sepolia to supply USDG.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
            <div className="lg:col-span-5 grid grid-cols-2 gap-3">
              <Stat label="Your Supply" value={liveAccount ? fmtUSD(liveAccount.lender.suppliedUSD) : '…'} />
              <Stat
                label="Wallet USDG"
                value={liveAccount ? fmtUSD(liveAccount.wallet.usdg) : '…'}
                hint={liveAccount && liveAccount.wallet.usdg === 0 ? 'get testnet USDG ↗' : undefined}
              />
            </div>
            <div className="lg:col-span-7 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full pl-7 pr-16 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-white font-mono text-sm focus:outline-none focus:border-zinc-600"
                  aria-label="USDG amount to supply"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">USDG</span>
              </div>
              <Button
                variant="primary"
                size="md"
                disabled={busy || !(Number(amount) > 0)}
                onClick={() => supplyUSDG(amount)}
                className="font-mono text-xs"
              >
                Supply
              </Button>
              <Button
                variant="outline"
                size="md"
                disabled={busy || !liveAccount || liveAccount.lender.withdrawableUSD === 0}
                onClick={() => withdrawAllUSDG()}
                className="font-mono text-xs"
              >
                Withdraw {liveAccount && liveAccount.lender.withdrawableUSD > 0 ? fmtUSD(liveAccount.lender.withdrawableUSD) : ''}
              </Button>
            </div>
          </div>
        )}

        <p className="text-[11px] font-mono text-zinc-500 flex flex-wrap items-center gap-1">
          Lenders can redeem idle cash at any time; lent-out funds return as loans are repaid. Bad debt from
          under-collateralized liquidations is shared by lenders through the share price.
          <a href={USDG_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-zinc-300 hover:text-white">
            Paxos USDG faucet <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
