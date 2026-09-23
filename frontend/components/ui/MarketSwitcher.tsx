'use client';

import React from 'react';
import clsx from 'clsx';
import { useMarket } from '@/lib/context/MarketContext';

/** Pill toggle between lending markets; hidden when only one market is deployed. */
export function MarketSwitcher() {
  const { market, markets, setMarketId } = useMarket();
  if (markets.length < 2) return null;
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 font-mono text-[11px]" role="tablist">
      {markets.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={m.id === market.id}
          onClick={() => setMarketId(m.id)}
          className={clsx(
            'px-2.5 py-1 rounded-md transition-colors',
            m.id === market.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
