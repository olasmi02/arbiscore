'use client';

import React from 'react';
import { useSandbox } from '@/lib/context/SandboxContext';
import { CONTRACT_ADDRESSES, MARKETS, USDG_FAUCET_URL } from '@/lib/web3/addresses';
import { Wallet } from 'lucide-react';

const fmt = (n: number, digits: number) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

/** The connected wallet's own token balances (live mode only). */
export function WalletBalances() {
  const { isLiveMode, liveAccount } = useSandbox();
  if (!isLiveMode) return null;
  const w = liveAccount?.wallet;

  const items: { label: string; value: string; hint?: string; href?: string }[] = [
    { label: 'ETH (gas)', value: w ? fmt(w.eth, 5) : '…', hint: w && w.eth === 0 ? 'needs Sepolia ETH for gas' : undefined },
    {
      label: 'WETH (test)',
      value: w ? fmt(w.weth, 4) : '…',
      hint: w && w.weth === 0 ? 'use Test WETH to get some' : undefined,
      href: `https://sepolia.arbiscan.io/token/${CONTRACT_ADDRESSES.weth}`,
    },
    {
      label: 'USDG (Paxos)',
      value: w ? fmt(w.usdg, 2) : '…',
      hint: w && w.usdg === 0 ? 'from faucet.paxos.com' : undefined,
      href: USDG_FAUCET_URL,
    },
    {
      label: 'USDC (test)',
      value: w ? fmt(w.usdc, 2) : '…',
      hint: w && w.usdc === 0 ? 'use Test USDC to get some' : undefined,
      href: `https://sepolia.arbiscan.io/token/${MARKETS.USDC.asset}`,
    },
  ];

  return (
    <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800">
      <div className="flex items-center gap-2 mb-3 text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
        <Wallet className="w-3.5 h-3.5 text-zinc-500" /> Your wallet balances
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((it) => (
          <div key={it.label} className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              {it.href ? (
                <a href={it.href} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">
                  {it.label}
                </a>
              ) : (
                it.label
              )}
            </div>
            <div className="text-base font-semibold text-white font-mono tabular-nums mt-0.5">{it.value}</div>
            {it.hint && <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{it.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
