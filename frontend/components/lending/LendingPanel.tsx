'use client';

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MarketSwitcher } from '@/components/ui/MarketSwitcher';
import { useMarketStats } from '@/hooks/useOnChainBorrower';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { useSandbox } from '@/lib/context/SandboxContext';
import { useMarket } from '@/lib/context/MarketContext';
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

/**
 * Lender side of the selected market: supply its stablecoin and earn the interest credit-scored
 * borrowers pay (ERC-4626 shares). Markets share one credit engine.
 */
export function LendingPanel() {
  const { isConnected } = useAccount();
  const { data: stats, isLoading } = useMarketStats();
  const { market } = useMarket();
  const { liveAccount } = useSandbox();
  const { supply, withdrawSupply, claimTestStable, txStatus } = useCreditVaultTx();
  const [amount, setAmount] = useState('10');
  const busy = txStatus.step !== 'idle' && txStatus.step !== 'confirmed' && txStatus.step !== 'failed';
  const sym = market.symbol;

  return (
    <Card className="shadow-fintech">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            <Landmark className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">{market.label} Lending Pool</h2>
            <p className="text-[11px] text-zinc-400 font-mono">
              Supply {sym} • earn the interest credit-scored borrowers pay • ERC-4626 as{sym} shares
            </p>
          </div>
        </div>
        <MarketSwitcher />
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Total Supplied" value={stats ? fmtUSD(stats.totalAssetsUSD) : isLoading ? '…' : '—'} />
          <Stat label="Available to Borrow" value={stats ? fmtUSD(stats.cashUSD) : '…'} />
          <Stat label="Utilization" value={stats ? fmtPct(stats.utilization) : '…'} />
          <Stat label="Supply APY" value={stats ? fmtPct(stats.supplyApr) : '…'} hint="loan-weighted APR × utilization" />
        </div>

        {!isConnected ? (
          <p className="text-xs font-mono text-zinc-500">Connect a wallet on Arbitrum Sepolia to supply {sym}.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
            <div className="lg:col-span-5 grid grid-cols-2 gap-3">
              <Stat label="Your Supply" value={liveAccount ? fmtUSD(liveAccount.lender.suppliedUSD) : '…'} />
              <Stat
                label={`Wallet ${sym}`}
                value={liveAccount ? fmtUSD(liveAccount.wallet.stable) : '…'}
                hint={liveAccount && liveAccount.wallet.stable === 0 ? `get test ${sym} below` : undefined}
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
                  aria-label={`${sym} amount to supply`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">{sym}</span>
              </div>
              <Button
                variant="primary"
                size="md"
                disabled={busy || !(Number(amount) > 0)}
                onClick={() => supply(amount)}
                className="font-mono text-xs"
              >
                Supply
              </Button>
              <Button
                variant="outline"
                size="md"
                disabled={busy || !liveAccount || liveAccount.lender.withdrawableUSD === 0}
                onClick={() => withdrawSupply()}
                className="font-mono text-xs"
              >
                Withdraw {liveAccount && liveAccount.lender.withdrawableUSD > 0 ? fmtUSD(liveAccount.lender.withdrawableUSD) : ''}
              </Button>
            </div>
          </div>
        )}

        <div className="text-[11px] font-mono text-zinc-500 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Lenders can redeem idle cash at any time; lent-out funds return as loans are repaid. Bad debt from
            under-collateralized liquidations is shared by lenders through the share price.
          </span>
          {market.hasTokenFaucet ? (
            isConnected && (
              <button
                type="button"
                disabled={busy}
                onClick={() => claimTestStable()}
                className="text-zinc-300 hover:text-white underline underline-offset-2"
              >
                Claim 1,000 test {sym}
              </button>
            )
          ) : (
            <a href={USDG_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-zinc-300 hover:text-white">
              Paxos USDG faucet <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
