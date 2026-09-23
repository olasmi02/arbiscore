'use client';

import React from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { CollateralCard } from './CollateralCard';
import { ActiveLoansTable } from './ActiveLoansTable';
import { Layers } from 'lucide-react';
import { useSandbox } from '@/lib/context/SandboxContext';

export function PositionManager() {
  const { isLiveMode, activePersona } = useSandbox();
  return (
    <Card className="shadow-fintech">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">
              Position Escrow & Active Obligations
            </h2>
            <p className="text-[11px] text-zinc-400 font-mono">
              Collateral locked in escrow vs unencumbered borrowing power
            </p>
          </div>
        </div>
        {!isLiveMode && (
          <span className="self-start sm:self-auto px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold whitespace-nowrap">
            Simulated · {activePersona.name.split(' ')[0]}
          </span>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        <CollateralCard />
        <ActiveLoansTable />
      </CardContent>
    </Card>
  );
}
