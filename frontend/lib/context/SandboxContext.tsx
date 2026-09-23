'use client';

import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { BorrowerPersona, PersonaId } from '@/lib/types';
import { PERSONA_META, buildPersona, initialPersonaLoans, type SandboxLoan } from '@/lib/personas';
import { LOAN_LIQUIDATED, LOAN_OPEN, LOAN_REPAID } from '@/lib/scoring/model';
import { useOnChainBorrower, type OnChainBorrower } from '@/hooks/useOnChainBorrower';

interface CollateralState {
  depositedETH: number;
  lockedETH: number;
  freeETH: number;
}

interface SandboxContextType {
  isSandboxMode: boolean;
  setIsSandboxMode: (enabled: boolean) => void;
  /** True when the dashboard shows the connected wallet's on-chain profile. */
  isLiveMode: boolean;
  liveStatus: { loading: boolean; error: string | null; scoreVerified: boolean; hasHistory: boolean };
  /** Connected wallet's on-chain account (lender position, balances), when available. */
  liveAccount: OnChainBorrower | undefined;
  activePersonaId: PersonaId;
  setActivePersonaId: (id: PersonaId) => void;
  activePersona: BorrowerPersona;
  /** Sandbox personas as currently modified (for the persona switcher). */
  sandboxPersonas: Record<PersonaId, BorrowerPersona>;
  collateralState: CollateralState;
  simulationNotice: string | null;
  simulateRepayment: () => void;
  simulateLiquidation: () => void;
  resetSimulation: () => void;
  depositSimulationCollateral: (amountETH: number) => void;
  withdrawSimulationCollateral: (amountETH: number) => void;
  borrowSimulationLoan: (amountUSDG: number, requiredETH: number) => void;
  repaySimulationLoan: (loanId: number) => void;
  /** Moves the sandbox clock forward: every loan and the wallet age grow older. */
  advanceTime: (days: number) => void;
}

interface PersonaState {
  loans: SandboxLoan[];
  depositedETH: number;
  extraDays: number;
}

const SandboxContext = createContext<SandboxContextType | undefined>(undefined);

const PERSONA_IDS: PersonaId[] = ['alice', 'bob', 'charlie'];
const initialState = (id: PersonaId): PersonaState => ({
  loans: initialPersonaLoans(id),
  depositedETH: PERSONA_META[id].depositedETH,
  extraDays: 0,
});

export function SandboxProvider({ children }: { children: React.ReactNode }) {
  const [isSandboxMode, setIsSandboxMode] = useState<boolean>(true);
  const [activePersonaId, setActivePersonaId] = useState<PersonaId>('charlie');
  const [simulationNotice, setSimulationNotice] = useState<string | null>(null);
  const [states, setStates] = useState<Record<PersonaId, PersonaState>>(() =>
    Object.fromEntries(PERSONA_IDS.map((id) => [id, initialState(id)])) as Record<PersonaId, PersonaState>
  );

  const { isConnected } = useAccount();
  const live = useOnChainBorrower();
  const isLiveMode = !isSandboxMode && isConnected;

  // Connecting a wallet switches to the live on-chain view; disconnecting returns to the sandbox.
  // Only the transition triggers this, so users can still flip back to the sandbox while connected.
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected !== wasConnected.current) setIsSandboxMode(!isConnected);
    wasConnected.current = isConnected;
  }, [isConnected]);

  const sandboxPersonas = useMemo(
    () =>
      Object.fromEntries(PERSONA_IDS.map((id) => [id, buildPersona(id, states[id].loans, states[id].extraDays)])) as Record<
        PersonaId,
        BorrowerPersona
      >,
    [states]
  );

  const sandboxCollateral = useMemo<CollateralState>(() => {
    const s = states[activePersonaId];
    const lockedETH = s.loans
      .filter((l) => l.status === LOAN_OPEN)
      .reduce((sum, l) => sum + (l.collateralLockedETH ?? 0), 0);
    return { depositedETH: s.depositedETH, lockedETH, freeETH: Math.max(0, s.depositedETH - lockedETH) };
  }, [states, activePersonaId]);

  const activePersona = isLiveMode && live.data ? live.data.persona : sandboxPersonas[activePersonaId];
  const collateralState = isLiveMode && live.data ? live.data.collateral : sandboxCollateral;

  // Apply a model-scored change to the active persona and report the score movement.
  const update = useCallback(
    (fn: (s: PersonaState) => PersonaState, describe: (before: number, after: number) => string) => {
      const cur = states[activePersonaId];
      const before = buildPersona(activePersonaId, cur.loans, cur.extraDays).score;
      const next = fn(cur);
      const after = buildPersona(activePersonaId, next.loans, next.extraDays).score;
      setStates((prev) => ({ ...prev, [activePersonaId]: next }));
      setSimulationNotice(describe(before, after));
    },
    [activePersonaId, states]
  );

  const delta = (before: number, after: number) =>
    `${before} → ${after} (${after >= before ? '+' : ''}${after - before} pts)`;

  const closeLoan = (s: PersonaState, status: number, loanId?: number): PersonaState => {
    const idx =
      loanId !== undefined
        ? s.loans.findIndex((l) => l.positionId === loanId)
        : s.loans.findIndex((l) => l.status === LOAN_OPEN);
    if (idx !== -1 && s.loans[idx].status === LOAN_OPEN) {
      const loans = [...s.loans];
      // Closing an overdue loan (30-day term) records how late it was
      loans[idx] = { ...loans[idx], status, daysLate: Math.max(0, loans[idx].borrowedDaysAgo - 30) };
      // Liquidation seizes the locked collateral
      const seized = status === LOAN_LIQUIDATED ? loans[idx].collateralLockedETH ?? 0 : 0;
      return { ...s, loans, depositedETH: Math.max(0, s.depositedETH - seized) };
    }
    // No open loan: record a $1,000 loan taken 30 days ago (seasoned) with this outcome
    return { ...s, loans: [...s.loans, { amountUsd: 1_000, borrowedDaysAgo: 30, status, daysLate: 0 }] };
  };

  const simulateRepayment = useCallback(() => {
    const openLoan = states[activePersonaId].loans.find((l) => l.status === LOAN_OPEN);
    const late = openLoan ? Math.max(0, openLoan.borrowedDaysAgo - 30) : 0;
    update(
      (s) => closeLoan(s, LOAN_REPAID),
      (b, a) =>
        !openLoan
          ? `No open loan to repay, so a new $1,000 loan repaid on time was added. Score ${delta(b, a)}.`
          : late > 0
            ? `Repayment recorded ${late} days late. Score ${delta(b, a)}: late repayments earn less credit than on-time ones.`
            : `✓ On-time repayment recorded. Score ${delta(b, a)}, re-scored by the model.`
    );
  }, [update, states, activePersonaId]);

  const simulateLiquidation = useCallback(() => {
    const openLoan = states[activePersonaId].loans.find((l) => l.status === LOAN_OPEN);
    update(
      (s) => closeLoan(s, LOAN_LIQUIDATED),
      (b, a) =>
        openLoan
          ? `⚠ Liquidation recorded as a default. Score ${delta(b, a)}; collateral ratio re-tiered.`
          : `⚠ No open loan, so a new $1,000 loan recorded as liquidated was added. Score ${delta(b, a)}.`
    );
  }, [update, states, activePersonaId]);

  const resetSimulation = useCallback(() => {
    setStates((prev) => ({ ...prev, [activePersonaId]: initialState(activePersonaId) }));
    setSimulationNotice('Simulation reset to the archetype baseline.');
  }, [activePersonaId]);

  const depositSimulationCollateral = useCallback(
    (amountETH: number) => {
      setStates((prev) => {
        const cur = prev[activePersonaId];
        return { ...prev, [activePersonaId]: { ...cur, depositedETH: cur.depositedETH + amountETH } };
      });
      setSimulationNotice(`Deposited ${amountETH} WETH to collateral escrow.`);
    },
    [activePersonaId]
  );

  const withdrawSimulationCollateral = useCallback(
    (amountETH: number) => {
      setStates((prev) => {
        const cur = prev[activePersonaId];
        return { ...prev, [activePersonaId]: { ...cur, depositedETH: Math.max(0, cur.depositedETH - amountETH) } };
      });
      setSimulationNotice(`Withdrew ${amountETH} WETH from collateral escrow.`);
    },
    [activePersonaId]
  );

  const borrowSimulationLoan = useCallback(
    (amountUSDG: number, requiredETH: number) => {
      update(
        (s) => {
          const positionId = 500 + s.loans.length + 1;
          return {
            ...s,
            loans: [
              ...s.loans,
              { amountUsd: amountUSDG, borrowedDaysAgo: 0, status: LOAN_OPEN, daysLate: 0, positionId, collateralLockedETH: requiredETH },
            ],
          };
        },
        (b, a) => `Borrowed $${amountUSDG.toLocaleString()} USDG. Open exposure re-scored: ${delta(b, a)}.`
      );
    },
    [update]
  );

  const repaySimulationLoan = useCallback(
    (loanId: number) => {
      const loan = states[activePersonaId].loans.find((l) => l.positionId === loanId);
      const unseasoned = loan !== undefined && loan.borrowedDaysAgo < 14;
      update(
        (s) => closeLoan(s, LOAN_REPAID, loanId),
        (b, a) =>
          unseasoned
            ? `Loan #${loanId} repaid after ${loan!.borrowedDaysAgo}d. Score ${delta(b, a)}: loans held under 14 days earn little or no credit (blocks wash-borrowing). Try Fast-forward first.`
            : loan !== undefined && loan.borrowedDaysAgo > 30
              ? `Loan #${loanId} repaid ${loan.borrowedDaysAgo - 30} days late. Score ${delta(b, a)}: late repayments earn less credit.`
              : `Loan #${loanId} repaid on time. Score ${delta(b, a)}.`
      );
    },
    [update, states, activePersonaId]
  );

  const advanceTime = useCallback(
    (days: number) => {
      update(
        (s) => ({
          ...s,
          extraDays: s.extraDays + days,
          loans: s.loans.map((l) => ({ ...l, borrowedDaysAgo: l.borrowedDaysAgo + days })),
        }),
        (b, a) => `⏩ ${days} days later: every loan and the wallet are older. Score ${delta(b, a)}.`
      );
    },
    [update]
  );

  return (
    <SandboxContext.Provider
      value={{
        isSandboxMode,
        setIsSandboxMode,
        isLiveMode,
        liveStatus: {
          loading: isLiveMode && live.isLoading,
          error: live.error ? (live.error as Error).message : null,
          scoreVerified: live.data?.scoreVerified ?? true,
          hasHistory: live.data?.hasHistory ?? false,
        },
        liveAccount: live.data,
        activePersonaId,
        setActivePersonaId,
        activePersona,
        sandboxPersonas,
        collateralState,
        simulationNotice,
        simulateRepayment,
        simulateLiquidation,
        resetSimulation,
        depositSimulationCollateral,
        withdrawSimulationCollateral,
        borrowSimulationLoan,
        repaySimulationLoan,
        advanceTime,
      }}
    >
      {children}
    </SandboxContext.Provider>
  );
}

export function useSandbox() {
  const context = useContext(SandboxContext);
  if (!context) {
    throw new Error('useSandbox must be used within a SandboxProvider');
  }
  return context;
}
