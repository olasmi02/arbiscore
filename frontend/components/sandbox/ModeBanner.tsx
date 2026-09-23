'use client';

import React from 'react';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useSandbox } from '@/lib/context/SandboxContext';
import { FlaskConical } from 'lucide-react';

/**
 * Makes it unmistakable when the dashboard shows sample data instead of the visitor's wallet.
 * Hidden in live mode.
 */
export function ModeBanner() {
  const { isLiveMode, isSandboxMode, setIsSandboxMode, activePersona } = useSandbox();
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  if (isLiveMode) return null;

  return (
    <div
      role="status"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10"
    >
      <div className="flex items-start gap-2.5">
        <FlaskConical className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-100/90">
          <strong className="text-amber-300">Sandbox: sample data.</strong> You&apos;re viewing{' '}
          <strong className="text-white">{activePersona.name}</strong>, a simulated borrower scored in your browser by
          the same model the Stylus engine runs. These balances and loans are not your wallet.
        </p>
      </div>
      {isConnected ? (
        <button
          type="button"
          onClick={() => setIsSandboxMode(false)}
          className="self-start sm:self-auto whitespace-nowrap px-3 py-1.5 rounded-lg bg-white text-zinc-950 text-xs font-mono font-semibold hover:bg-zinc-200"
        >
          View my wallet
        </button>
      ) : (
        <button
          type="button"
          onClick={() => connect({ connector: injected() })}
          className="self-start sm:self-auto whitespace-nowrap px-3 py-1.5 rounded-lg bg-white text-zinc-950 text-xs font-mono font-semibold hover:bg-zinc-200"
        >
          {isSandboxMode ? 'Connect to see your own profile' : 'Connect wallet to go live'}
        </button>
      )}
    </div>
  );
}
