'use client';

import React from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { FICOGauge } from './FICOGauge';
import { ScoreBadge } from './ScoreBadge';
import { FactorBreakdown } from './FactorBreakdown';
import { BorrowerPersona } from '@/lib/types';
import { useSandbox } from '@/lib/context/SandboxContext';
import { Shield, BadgeCheck, AlertTriangle } from 'lucide-react';

interface CreditScoreCardProps {
  persona: BorrowerPersona;
}

export function CreditScoreCard({ persona }: CreditScoreCardProps) {
  const { isLiveMode, liveStatus } = useSandbox();
  return (
    <Card className="shadow-fintech overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            <Shield className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">
              On-Chain Risk & Credit Evaluation
            </h2>
            <p className="text-[11px] text-zinc-400 font-mono">
              {isLiveMode
                ? 'Live read from the Arbitrum Stylus (Rust) engine'
                : 'Sandbox: same model the Stylus engine runs, evaluated in-browser'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLiveMode && liveStatus.hasHistory && (
            <span
              title="Score recomputed in the browser from on-chain loan history, compared with the engine's result"
              className={
                liveStatus.scoreVerified
                  ? 'hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border bg-amber-500/10 text-amber-400 border-amber-500/20'
              }
            >
              {liveStatus.scoreVerified ? <BadgeCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {liveStatus.scoreVerified ? 'Independently verified' : 'Verification mismatch'}
            </span>
          )}
          <ScoreBadge score={persona.score} />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: FICO Gauge */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center p-4 rounded-xl bg-zinc-950/40 border border-zinc-800/80">
            <FICOGauge score={persona.score} />
            <div className="mt-4 text-center">
              <div className="text-xs font-medium text-zinc-200">
                Current Borrower: <span className="font-semibold text-white">{persona.name}</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono mt-0.5 max-w-xs">
                {persona.tagline}
              </div>
            </div>
          </div>

          {/* Right Column: 4 Itemized Factor Cards */}
          <div className="lg:col-span-7">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                Algorithmic Factor Breakdown
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                P(repay) {(persona.factors.probability * 100).toFixed(1)}% • vs. new wallet
              </span>
            </div>
            <FactorBreakdown factors={persona.factors} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
