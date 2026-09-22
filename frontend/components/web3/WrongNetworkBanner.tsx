'use client';

import React from 'react';
import { useNetworkEnforcer } from '@/hooks/useNetworkEnforcer';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function WrongNetworkBanner() {
  const { showWrongNetworkBanner, targetChain, isSwitching, handleSwitchToArbitrumSepolia } =
    useNetworkEnforcer();

  if (!showWrongNetworkBanner) return null;

  return (
    <div className="w-full bg-rose-950/80 border-b border-rose-800/80 backdrop-blur px-4 py-3 text-rose-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <p className="text-sm">
            <strong className="font-semibold text-white">Wrong Network:</strong> ArbiScore
            runs exclusively on <span className="font-mono text-white underline">{targetChain.name} (Chain ID: 421614)</span>.
            Switch networks to interact with smart contracts.
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={handleSwitchToArbitrumSepolia}
          isLoading={isSwitching}
          rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          className="flex-shrink-0 font-mono"
        >
          Switch to Arbitrum Sepolia
        </Button>
      </div>
    </div>
  );
}
