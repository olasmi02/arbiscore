'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { BorrowSlider } from './BorrowSlider';
import { DeFiComparisonCard } from './DeFiComparisonCard';
import { BorrowActionModal } from './BorrowActionModal';
import { calculateBorrowQuote } from '@/lib/math';
import { quoteAprBps, liquidationThresholdPercent } from '@/lib/rates';
import { BorrowerPersona } from '@/lib/types';
import { useSandbox } from '@/lib/context/SandboxContext';
import { useMarketStats } from '@/hooks/useOnChainBorrower';
import { ArrowLeftRight } from 'lucide-react';

// Sandbox previews use a notional $1M pool at 50% utilization for APR.
const SANDBOX_POOL = { totalAssetsUSD: 1_000_000, totalPrincipalUSD: 500_000, cashUSD: 500_000 };

interface BorrowModuleProps {
  persona: BorrowerPersona;
}

export function BorrowModule({ persona }: BorrowModuleProps) {
  const [borrowAmount, setBorrowAmount] = useState<number>(10000);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const { isLiveMode } = useSandbox();
  const { data: market } = useMarketStats();
  const price = market?.ethPriceUSD ?? 3000;
  const pool = isLiveMode && market ? market : SANDBOX_POOL;
  // Live: loans are limited by real USDG liquidity in the pool
  const limits = isLiveMode ? { min: 1, max: Math.max(1, Math.floor(pool.cashUSD)) } : { min: 100, max: 50_000 };

  const base = calculateBorrowQuote(borrowAmount, persona.score, price, limits);
  const quote = {
    ...base,
    aprPercent: quoteAprBps(base.tier, base.borrowAmountUSD, pool.totalAssetsUSD, pool.totalPrincipalUSD) / 100,
    liqThresholdPercent: liquidationThresholdPercent(base.tier),
  };

  return (
    <Card className="shadow-fintech">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            <ArrowLeftRight className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">
              Dynamic Borrow Calculator & Capital Efficiency
            </h2>
            <p className="text-[11px] text-zinc-400 font-mono">
              {market ? 'Live Chainlink ETH/USD' : 'Reference $3,000 / ETH'} • borrow Paxos USDG
              {isLiveMode && market && ` • ${market.cashUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDG available`}
            </p>
          </div>
        </div>

        <div className="text-xs font-mono text-zinc-400">
          Target Ratio: <span className="font-bold text-white">{quote.requiredRatioPercent}%</span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Column: Interactive Borrow Slider */}
          <div className="lg:col-span-7 flex flex-col justify-between p-6 rounded-xl bg-zinc-950/40 border border-zinc-800/80">
            <BorrowSlider
              value={quote.borrowAmountUSD}
              onChange={setBorrowAmount}
              min={limits.min}
              max={Math.max(limits.min + 1, limits.max)}
              step={isLiveMode ? 1 : 50}
            />

            <div className="mt-8 pt-6 border-t border-zinc-800/80 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center font-mono">
              <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Oracle Price</div>
                <div className="text-sm font-bold text-zinc-200 tabular-nums">
                  ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Required ETH</div>
                <div className="text-sm font-bold text-white tabular-nums">
                  {quote.requiredCollateralETH.toFixed(4)}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Fixed APR</div>
                <div className="text-sm font-bold text-white tabular-nums">{quote.aprPercent.toFixed(2)}%</div>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Borrow Asset</div>
                <div className="text-sm font-bold text-emerald-400">USDG (Paxos)</div>
              </div>
            </div>
          </div>

          {/* Right Column: High-Contrast Comparison Card */}
          <div className="lg:col-span-5">
            <DeFiComparisonCard
              quote={quote}
              onOpenBorrowModal={() => setIsModalOpen(true)}
            />
          </div>
        </div>
      </CardContent>

      {/* Execution Modal */}
      <BorrowActionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        quote={quote}
      />
    </Card>
  );
}
