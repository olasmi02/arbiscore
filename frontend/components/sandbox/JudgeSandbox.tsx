'use client';

import React from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { PersonaSwitcher } from './PersonaSwitcher';
import { ActionSimulator } from './ActionSimulator';
import { Sparkles, Terminal } from 'lucide-react';

export function JudgeSandbox() {
  return (
    <Card className="shadow-fintech border-zinc-800">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700/60">
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">
              Judge Evaluation Sandbox & Profile Emulator
            </h2>
            <p className="text-[11px] text-zinc-400 font-mono">
              Toggle between borrower archetypes and simulate live credit rating elevation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400">
          <Terminal className="w-3.5 h-3.5 text-zinc-500" />
          <span>Interactive Sandbox</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-2.5">
            1. Select Borrower Archetype
          </div>
          <PersonaSwitcher />
        </div>

        <div className="pt-2 border-t border-zinc-800/80">
          <div className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-2.5">
            2. Simulate Protocol State Mutations
          </div>
          <ActionSimulator />
        </div>
      </CardContent>
    </Card>
  );
}
