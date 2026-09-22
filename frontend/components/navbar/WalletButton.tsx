'use client';

import React, { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { Wallet, LogOut, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const [mounted, setMounted] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="secondary" size="sm" className="font-mono">
        <Wallet className="w-3.5 h-3.5 mr-1.5" />
        Connect Wallet
      </Button>
    );
  }

  if (!isConnected || !address) {
    return (
      <Button
        variant="primary"
        size="sm"
        isLoading={isPending}
        onClick={() => connect({ connector: injected() })}
        leftIcon={<Wallet className="w-3.5 h-3.5" />}
        className="font-mono text-xs shadow-sm"
      >
        Connect Wallet
      </Button>
    );
  }

  const truncatedAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-200 transition-colors"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <span>{truncatedAddress}</span>
        {balance && (
          <span className="text-zinc-500 text-[11px] tabular-nums hidden sm:inline">
            ({parseFloat(balance.formatted).toFixed(3)} ETH)
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
      </button>

      {showDropdown && (
        <div
          className="absolute right-0 mt-2 w-48 rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl p-1.5 z-50 text-xs font-mono"
          onClick={() => setShowDropdown(false)}
        >
          <div className="px-3 py-2 border-b border-zinc-800/80 mb-1 text-[11px] text-zinc-400 break-all">
            {address}
          </div>
          <button
            onClick={() => disconnect()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800 text-rose-400 transition-colors text-left"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
