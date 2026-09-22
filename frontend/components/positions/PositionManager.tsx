'use client';

import React from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { CollateralCard } from './CollateralCard';
import { ActiveLoansTable } from './ActiveLoansTable';
import { Layers, Wallet } from 'lucide-react';

export function PositionManager() {
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
      </CardHeader>

      <CardContent className="space-y-6">
        <CollateralCard />
        <ActiveLoansTable />
      </CardContent>
    </Card>
  );
}
