'use client';

import { useMarket } from '@/lib/context/MarketContext';
import React from 'react';
import { BorrowQuote } from '@/lib/types';
import { ArrowUpRight, TrendingUp, Sparkles, Check, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface DeFiComparisonCardProps {
  quote: BorrowQuote;
  onOpenBorrowModal: () => void;
}

export function DeFiComparisonCard({ quote, onOpenBorrowModal }: DeFiComparisonCardProps) {
  const { market: mkt } = useMarket();
  const isPrimeOrNearPrime = quote.tierName === 'Prime' || quote.tierName === 'Near-Prime';
  const hasSavings = quote.collateralSavedETH > 0;

  return (
    <div className="p-6 rounded-xl bg-zinc-950/60 border border-zinc-800 flex flex-col justify-between h-full">
      <div>
        {/* Header Badge */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>ArbiScore Adaptive Efficiency</span>
          </div>

          <div className="text-xs font-mono font-semibold text-emerald-400">
            {quote.requiredRatioPercent}% LTV vs 150%
          </div>
        </div>

        {/* Primary Headline Metric: Collateral Saved */}
        <div className="mb-6">
          <div className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-1">
            Collateral Saved vs. Traditional DeFi
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl sm:text-4xl font-extrabold text-white font-mono tabular-nums tracking-tight">
              {hasSavings ? quote.collateralSavedUSDFormatted : '$0.00'}
            </span>
            {hasSavings && (
              <span className="text-sm font-mono text-emerald-400 font-bold tabular-nums">
                ({quote.collateralSavedETH.toFixed(4)} ETH)
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            {hasSavings ? (
              <span>
                Your <strong className="text-white">{quote.tierName}</strong> status frees up{' '}
                <strong className="text-emerald-400">
                  {quote.collateralSavedETH.toFixed(4)} ETH
                </strong>{' '}
                in unencumbered capital.
              </span>
            ) : (
              <span>
                Subprime tier requires standard 150% collateral baseline. Repay on-time to unlock 105% Prime tier!
              </span>
            )}
          </p>
        </div>

        {/* Comparison Side-by-Side Breakdown */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {/* ArbiScore Dynamic Requirement */}
          <div className="p-3.5 rounded-lg bg-zinc-900/80 border border-emerald-500/30">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 font-semibold mb-1">
              <Unlock className="w-3.5 h-3.5" />
              <span>ArbiScore ({quote.requiredRatioPercent}%)</span>
            </div>
            <div className="text-lg font-bold text-white font-mono tabular-nums">
              {quote.requiredCollateralETH.toFixed(4)} ETH
            </div>
            <div className="text-[11px] text-zinc-400 font-mono tabular-nums mt-0.5">
              ${(quote.borrowAmountUSD * (quote.requiredRatioBps / 10000)).toLocaleString('en-US', {
                maximumFractionDigits: 0,
              })}{' '}
              Collateral
            </div>
          </div>

          {/* Traditional DeFi Fixed Baseline */}
          <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-800">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 font-semibold mb-1">
              <Lock className="w-3.5 h-3.5" />
              <span>Traditional (150%)</span>
            </div>
            <div className="text-lg font-bold text-zinc-300 font-mono tabular-nums">
              {quote.traditionalCollateralETH.toFixed(4)} ETH
            </div>
            <div className="text-[11px] text-zinc-500 font-mono tabular-nums mt-0.5">
              ${(quote.borrowAmountUSD * 1.5).toLocaleString('en-US', { maximumFractionDigits: 0 })}{' '}
              Collateral
            </div>
          </div>
        </div>

        {/* Visual Capital Distribution Progress Bar */}
        <div className="space-y-1.5 mb-6">
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span>Capital Efficiency</span>
            <span className="text-emerald-400 font-bold tabular-nums">
              {quote.capitalEfficiencyGain.toFixed(1)}% Saved
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-zinc-800 overflow-hidden flex">
            <div
              className="bg-zinc-600 transition-all duration-300"
              style={{
                width: `${100 - quote.capitalEfficiencyGain}%`,
              }}
              title="Locked Collateral"
            />
            <div
              className="bg-emerald-500 transition-all duration-300"
              style={{
                width: `${quote.capitalEfficiencyGain}%`,
              }}
              title="Unencumbered Capital Saved"
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              Locked Collateral
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Capital Unleashed
            </span>
          </div>
        </div>
      </div>

      {/* CTA Button */}
      <Button
        variant="primary"
        size="lg"
        onClick={onOpenBorrowModal}
        rightIcon={<ArrowUpRight className="w-4 h-4" />}
        className="w-full font-mono text-sm shadow-md"
      >
        Borrow ${quote.borrowAmountUSD.toLocaleString()} {mkt.symbol}
      </Button>
    </div>
  );
}
