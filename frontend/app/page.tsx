'use client';

import React from 'react';
import { Header } from '@/components/navbar/Header';
import { CreditScoreCard } from '@/components/credit/CreditScoreCard';
import { BorrowModule } from '@/components/borrow/BorrowModule';
import { JudgeSandbox } from '@/components/sandbox/JudgeSandbox';
import { PositionManager } from '@/components/positions/PositionManager';
import { LendingPanel } from '@/components/lending/LendingPanel';
import { ImportCreditCard } from '@/components/credit/ImportCreditCard';
import { ModeBanner } from '@/components/sandbox/ModeBanner';
import { TransactionModal } from '@/components/web3/TransactionModal';
import { useSandbox } from '@/lib/context/SandboxContext';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { CONTRACT_ADDRESSES, MARKETS, AVAILABLE_MARKETS } from '@/lib/web3/addresses';
import { ExternalLink, ShieldCheck, Cpu, Terminal, Layers } from 'lucide-react';

export default function DashboardPage() {
  const { activePersona, isLiveMode } = useSandbox();
  const { txStatus, resetTx } = useCreditVaultTx();

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-[#fafafa]">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <ModeBanner />

        {/* Top Hero Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 shadow-fintech">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={
                  isLiveMode
                    ? 'whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold'
                    : 'whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold'
                }
              >
                {isLiveMode ? 'Live · your wallet' : 'Sandbox · sample data'}
              </span>
              <span className="text-xs font-mono text-zinc-500">•</span>
              <span className="text-xs font-mono text-zinc-400">
                Arbitrum Sepolia Testnet (421614)
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Adaptive On-Chain Credit & Lending Vault
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
              A credit model over your repayment history, running in Rust on{' '}
              <strong className="text-zinc-200">Arbitrum Stylus</strong>. Borrow{' '}
              <strong className="text-zinc-200">Paxos USDG</strong> (or test USDC) with as little as{' '}
              <strong className="text-emerald-400 font-mono">105% collateral</strong>, or lend it to earn interest.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Engine</div>
                <div className="font-bold text-white">Rust Stylus SDK</div>
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Collateral Ratio</div>
                <div className="font-bold text-white">105% – 125%</div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: FICO Credit Evaluation Module */}
        <CreditScoreCard persona={activePersona} />
        <ImportCreditCard />

        {/* Section 2: Dynamic Borrow Calculator & DeFi Comparison */}
        <BorrowModule persona={activePersona} />

        {/* Section 2b: Lender side of the market */}
        <LendingPanel />

        {/* Section 3: Judge Evaluation Sandbox */}
        <JudgeSandbox />

        {/* Section 4: Position Escrow & Active Obligations */}
        <PositionManager />
      </main>

      {/* Institutional Fintech Footer */}
      <footer className="w-full border-t border-zinc-800/80 bg-zinc-950/80 py-8 px-4 sm:px-6 lg:px-8 mt-12 text-xs font-mono text-zinc-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-zinc-300 font-semibold tracking-tight font-sans">
              ArbiScore Protocol
            </span>
            <span>•</span>
            <span>Stylus credit engine • USDG &amp; USDC credit markets</span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px]">
            {AVAILABLE_MARKETS.map((m) => (
              <a
                key={m.id}
                href={`https://sepolia.arbiscan.io/address/${m.vault}#code`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-300 flex items-center gap-1 transition-colors"
              >
                {m.symbol} Vault <ExternalLink className="w-3 h-3" />
              </a>
            ))}
            <a
              href={`https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESSES.stylusEngine}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              Stylus Score Contract <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://sepolia.arbiscan.io/address/${MARKETS.USDG.asset}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              USDG (Paxos) <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESSES.creditImporter}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              CreditImporter <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESSES.weth}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 flex items-center gap-1 transition-colors"
            >
              Test WETH <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>

      {/* Global Transaction Modal */}
      <TransactionModal status={txStatus} onClose={resetTx} />
    </div>
  );
}
