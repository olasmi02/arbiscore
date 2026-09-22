'use client';

import React from 'react';
import { useSandbox } from '@/lib/context/SandboxContext';
import { useAccount } from 'wagmi';
import { useCreditVaultTx } from '@/hooks/useCreditVaultTx';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CheckCircle2, AlertOctagon, Check } from 'lucide-react';
import clsx from 'clsx';

export function ActiveLoansTable() {
  const { isSandboxMode, activePersona, repaySimulationLoan } = useSandbox();
  const { isConnected } = useAccount();
  const { repayLoan, txStatus } = useCreditVaultTx();

  const handleRepay = async (loanId: number) => {
    if (isSandboxMode || !isConnected) {
      repaySimulationLoan(loanId);
    } else {
      await repayLoan(BigInt(loanId));
    }
  };

  const loans = activePersona.activeLoans;

  return (
    <div className="rounded-xl bg-zinc-950/60 border border-zinc-800 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between">
        <span className="text-xs font-mono uppercase tracking-wider text-zinc-300 font-semibold">
          Active Loans & Credit History ({loans.length})
        </span>
        <span className="text-[11px] font-mono text-zinc-500">
          Loans held 14+ days and repaid on time raise your score
        </span>
      </div>

      {loans.length === 0 ? (
        <div className="p-8 text-center font-mono">
          <div className="text-xs text-zinc-500">No active debt obligations found.</div>
          <div className="text-[11px] text-zinc-600 mt-1">
            Originate a loan using the dynamic borrow calculator above.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-zinc-900/60 border-b border-zinc-800/80 text-zinc-400 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Loan ID</th>
                <th className="px-4 py-3">Principal</th>
                <th className="px-4 py-3">Owed (APR)</th>
                <th className="px-4 py-3">Collateral Locked</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {loans.map((loan) => {
                const isActive = loan.status === 'Active';
                const isRepaid = loan.status === 'Repaid';
                const isLiquidated = loan.status === 'Liquidated';

                return (
                  <tr
                    key={loan.loanId}
                    className="hover:bg-zinc-900/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-semibold text-white">
                      #{loan.loanId}
                    </td>
                    <td className="px-4 py-3 font-bold text-white tabular-nums">
                      ${loan.amountUSDG.toLocaleString()} USDG
                    </td>
                    <td className="px-4 py-3 text-zinc-300 tabular-nums">
                      {isActive && loan.debtUSD !== undefined ? `$${loan.debtUSD.toFixed(4)}` : '—'}
                      {loan.aprPercent !== undefined && (
                        <span className="text-zinc-500"> ({loan.aprPercent.toFixed(2)}%)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300 tabular-nums">
                      {loan.collateralLockedETH.toFixed(4)} ETH
                    </td>
                    <td className="px-4 py-3 text-zinc-400 tabular-nums">
                      {loan.dueDateFormatted}
                    </td>
                    <td className="px-4 py-3">
                      {isActive && (
                        <Badge variant="warning" size="sm">
                          Active
                        </Badge>
                      )}
                      {isRepaid && (
                        <Badge variant="success" size="sm">
                          ✓ Repaid
                        </Badge>
                      )}
                      {isLiquidated && (
                        <Badge variant="danger" size="sm">
                          Defaulted
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isActive ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRepay(loan.loanId)}
                          isLoading={
                            txStatus.step === 'signing_approval' ||
                            txStatus.step === 'pending_action'
                          }
                          className="font-mono text-xs"
                        >
                          Repay Loan
                        </Button>
                      ) : (
                        <span className="text-[11px] text-zinc-500 italic">
                          {isRepaid ? 'Completed' : 'Liquidated'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
