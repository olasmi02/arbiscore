'use client';

import React from 'react';
import { NetworkBadge } from './NetworkBadge';
import { WalletButton } from './WalletButton';
import { ShieldCheck, Coins, Sparkles, ExternalLink } from 'lucide-react';
import { useMarketStats } from '@/hooks/useOnChainBorrower';
import { USDG_FAUCET_URL } from '@/lib/web3/addresses';
import { useMarket } from '@/lib/context/MarketContext';
import { useSandbox } from '@/lib/context/SandboxContext';
import { useAccount } from 'wagmi';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { Button } from '@/components/ui/Button';

export function Header() {
  const { isSandboxMode, setIsSandboxMode } = useSandbox();
  const { isConnected } = useAccount();
  const { claimTestWeth, claimTestStable, txStatus } = useCreditVaultTx();
  const { market: mkt } = useMarket();
  const { data: market } = useMarketStats();

  return (
    <header className="w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand & Protocol Identity */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-white shadow-fintech">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base sm:text-lg font-bold tracking-tight text-white">ArbiScore</span>
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60 hidden sm:inline-block">
              Stylus Risk Engine
            </span>
          </div>
        </div>

        {/* Center / Price Feed & Sandbox Mode Toggle */}
        <div className="hidden xl:flex items-center gap-4">
          {/* Oracle ETH Price Ticker */}
          <div
            title="Chainlink ETH/USD on Arbitrum Sepolia: the price the vaults use. Refreshed every 30 seconds."
            className="flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800/80 bg-zinc-900/60 text-xs font-mono"
          >
            <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Chainlink ETH / USD</span>
            <span className="text-zinc-200 tabular-nums font-semibold">
              {market ? `$${market.ethPriceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '…'}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${market ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
          </div>

          {/* Sandbox Switcher */}
          <button
            onClick={() => setIsSandboxMode(!isSandboxMode)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono transition-all ${
              isSandboxMode
                ? 'bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm'
                : 'bg-zinc-900/50 text-zinc-500 border-zinc-800 hover:text-zinc-300'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${isSandboxMode ? 'text-amber-400' : 'text-zinc-500'}`} />
            <span>Judge Sandbox {isSandboxMode ? 'Active' : 'Off'}</span>
          </button>
        </div>

        {/* Right / Web3 Controls */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Compact live ETH price below xl, where the center strip is hidden */}
          <div
            title="Chainlink ETH/USD on Arbitrum Sepolia: the price the vaults use. Refreshed every 30 seconds."
            className="hidden md:flex xl:hidden items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60 text-[11px] font-mono"
          >
            <span className="text-zinc-500">ETH</span>
            <span className="text-zinc-200 tabular-nums font-semibold">
              {market ? `$${market.ethPriceUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '…'}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${market ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
          </div>

          {/* Compact sandbox toggle below xl, where the center strip is hidden */}
          <button
            onClick={() => setIsSandboxMode(!isSandboxMode)}
            aria-label={`Judge sandbox ${isSandboxMode ? 'on' : 'off'}`}
            className={`xl:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono ${
              isSandboxMode ? 'bg-zinc-800 text-zinc-100 border-zinc-600' : 'bg-zinc-900/50 text-zinc-500 border-zinc-800'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${isSandboxMode ? 'text-amber-400' : 'text-zinc-500'}`} />
            <span>{isSandboxMode ? 'Sandbox' : 'Live'}</span>
          </button>
          <NetworkBadge />

          {/* Testnet faucets: test WETH collateral and test USDC here; real testnet USDG comes from Paxos */}
          {isConnected && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => claimTestWeth()}
                isLoading={txStatus.step === 'signing_action' || txStatus.step === 'pending_action'}
                leftIcon={<Coins className="w-3.5 h-3.5 text-zinc-400" />}
                className="hidden lg:inline-flex text-xs font-mono"
              >
                Test WETH
              </Button>
              {mkt.hasTokenFaucet ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => claimTestStable()}
                  className="hidden lg:inline-flex text-xs font-mono"
                >
                  Test {mkt.symbol}
                </Button>
              ) : (
                <a
                  href={USDG_FAUCET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden lg:inline-flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Get USDG <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </>
          )}

          <WalletButton />
        </div>
      </div>
    </header>
  );
}
