import { LOAN_OPEN, LOAN_REPAID, LOAN_LIQUIDATED, type LoanSpec } from './model.ts';

/**
 * Raw model inputs for the judge sandbox personas. The same data is pushed on-chain by
 * "Sync persona" (setMockProfile), so the sandbox score and the Stylus score match.
 */
export interface PersonaProfile {
  ageDays: number;
  totalTransactions: number;
  totalVolumeUSD: number;
  loans: LoanSpec[];
}

const loan = (amountUsd: number, borrowedDaysAgo: number, status: number, daysLate = 0): LoanSpec => ({
  amountUsd,
  borrowedDaysAgo,
  status,
  daysLate,
});

export const PERSONA_PROFILES: Record<'alice' | 'bob' | 'charlie', PersonaProfile> = {
  // 8 on-time repayments growing from $2k to $15k over 18 months, one current loan
  alice: {
    ageDays: 540,
    totalTransactions: 140,
    totalVolumeUSD: 48_000,
    loans: [
      loan(2_000, 500, LOAN_REPAID),
      loan(3_500, 430, LOAN_REPAID),
      loan(5_000, 360, LOAN_REPAID),
      loan(4_000, 290, LOAN_REPAID),
      loan(8_000, 220, LOAN_REPAID),
      loan(6_000, 150, LOAN_REPAID),
      loan(12_000, 90, LOAN_REPAID),
      loan(15_000, 45, LOAN_REPAID),
      loan(10_000, 10, LOAN_OPEN),
    ],
  },
  // Active trader, two recent liquidations and two late repayments
  bob: {
    ageDays: 200,
    totalTransactions: 220,
    totalVolumeUSD: 30_000,
    loans: [
      loan(3_000, 190, LOAN_REPAID, 12),
      loan(5_000, 160, LOAN_LIQUIDATED),
      loan(2_000, 130, LOAN_REPAID),
      loan(4_000, 95, LOAN_LIQUIDATED),
      loan(1_500, 60, LOAN_REPAID, 5),
      loan(2_500, 12, LOAN_OPEN),
    ],
  },
  // One small on-time repayment, now carrying a much larger open loan
  charlie: {
    ageDays: 120,
    totalTransactions: 55,
    totalVolumeUSD: 5_500,
    loans: [loan(800, 80, LOAN_REPAID), loan(5_000, 15, LOAN_OPEN)],
  },
};
