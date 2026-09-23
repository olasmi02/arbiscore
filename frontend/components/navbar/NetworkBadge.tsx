'use client';

import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { arbitrumSepolia } from '@/lib/web3/chains';

export function NetworkBadge() {
  const { chainId, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center gap-2 px-2 sm:px-3 py-1 rounded-full whitespace-nowrap border border-zinc-800 bg-zinc-900/80 text-xs font-mono text-zinc-400">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="hidden sm:inline">Arbitrum Sepolia • 421614</span>
      </div>
    );
  }

  if (isConnected && chainId !== arbitrumSepolia.id) {
    return (
      <div className="flex items-center gap-2 px-2 sm:px-3 py-1 rounded-full whitespace-nowrap border border-rose-500/40 bg-rose-500/10 text-xs font-mono text-rose-300">
        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
        Wrong chain<span className="hidden sm:inline">&nbsp;({chainId})</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 sm:px-3 py-1 rounded-full whitespace-nowrap border border-zinc-800 bg-zinc-900/80 text-xs font-mono text-zinc-300 hover:border-zinc-700 transition-colors">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="hidden sm:inline">Arbitrum Sepolia • 421614</span>
    </div>
  );
}
