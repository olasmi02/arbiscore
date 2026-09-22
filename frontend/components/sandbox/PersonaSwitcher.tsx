'use client';

import React from 'react';
import { useSandbox } from '@/lib/context/SandboxContext';
import { PersonaId } from '@/lib/types';
import clsx from 'clsx';
import { User, ShieldAlert, Award } from 'lucide-react';

export function PersonaSwitcher() {
  const { activePersonaId, setActivePersonaId, sandboxPersonas } = useSandbox();

  const personas = [
    {
      id: 'alice' as PersonaId,
      name: 'Alice',
      title: 'Institutional Prime',
      score: sandboxPersonas.alice.score,
      tier: `${sandboxPersonas.alice.tier} (${sandboxPersonas.alice.ratioLabel})`,
      badgeColor: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      icon: Award,
    },
    {
      id: 'charlie' as PersonaId,
      name: 'Charlie',
      title: 'Fresh / Moderate',
      score: sandboxPersonas.charlie.score,
      tier: `${sandboxPersonas.charlie.tier} (${sandboxPersonas.charlie.ratioLabel})`,
      badgeColor: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
      icon: User,
    },
    {
      id: 'bob' as PersonaId,
      name: 'Bob',
      title: 'High-Risk Degen',
      score: sandboxPersonas.bob.score,
      tier: `${sandboxPersonas.bob.tier} (${sandboxPersonas.bob.ratioLabel})`,
      badgeColor: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {personas.map((p) => {
        const isSelected = activePersonaId === p.id;
        const Icon = p.icon;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setActivePersonaId(p.id)}
            className={clsx(
              'p-4 rounded-xl border text-left transition-all duration-150 relative select-none',
              isSelected
                ? 'bg-zinc-900 border-zinc-500 shadow-fintech ring-1 ring-zinc-500'
                : 'bg-zinc-950/60 hover:bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-700'
            )}
          >
            {isSelected && (
              <div className="absolute top-2.5 right-2.5 flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </div>
            )}

            <div className="flex items-center gap-2 mb-2">
              <div
                className={clsx(
                  'p-1.5 rounded-lg border',
                  isSelected ? 'bg-zinc-800 text-white border-zinc-700' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-bold text-white tracking-tight">{p.name}</div>
                <div className="text-[10px] font-mono text-zinc-500">{p.title}</div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-zinc-800/70 font-mono">
              <span className="text-xs text-zinc-400">Target Score:</span>
              <span className="text-sm font-bold text-white tabular-nums">{p.score}</span>
            </div>

            <div className="mt-1.5 flex justify-end">
              <span
                className={clsx(
                  'px-2 py-0.5 rounded text-[10px] font-mono font-semibold border',
                  p.badgeColor
                )}
              >
                {p.tier}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
