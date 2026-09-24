import type { PersonaProfile } from './scoring/personaProfiles.ts';

export const MIN_SCORE = 300;
export const MAX_SCORE = 850;
export const BASE_SCORE = 300;

export const RiskTier = {
  Subprime: 0,
  Moderate: 1,
  NearPrime: 2,
  Prime: 3,
} as const;

export type RiskTierType = (typeof RiskTier)[keyof typeof RiskTier];

export interface RiskTierInfo {
  tier: RiskTierType;
  name: 'Subprime' | 'Moderate' | 'Near-Prime' | 'Prime';
  ratioBps: number;
  ratioPercent: number;
  badgeColor: string;
  bgLight: string;
  borderColor: string;
}

export interface BorrowerMetrics {
  ageDays: number;
  totalTransactions: number;
  totalVolumeUSD: number;
  loansTaken: number;
  loansRepaid: number;
  liquidations: number;
}

/** Leave-one-out score impact (points) and raw value (0-1) of each model feature. */
export interface FactorBreakdown {
  probability: number; // modelled probability of good repayment (0-1)
  impacts: {
    quality: number;
    depth: number;
    liquidation: number;
    age: number;
    activity: number;
    volume: number;
    utilization: number;
  };
  features: FactorBreakdown['impacts'];
  repaidOnTime: number;
  repaidLate: number;
  liquidations: number;
  delinquent: number; // open loans past due
  openLoans: number;
  ageDays: number;
  txCount: number;
  volumeUSD: number;
}

export interface LoanRecord {
  loanId: bigint;
  borrower: string;
  borrowAmountUSDG: bigint;
  collateralLockedWei: bigint;
  borrowRatioBps: number;
  borrowTimestamp: bigint;
  dueDate: bigint;
  isRepaid: boolean;
  isLiquidated: boolean;
}

export interface BorrowQuote {
  score: number;
  tier: RiskTierType;
  tierName: 'Subprime' | 'Moderate' | 'Near-Prime' | 'Prime';
  requiredRatioBps: number;
  requiredRatioPercent: number;
  requiredCollateralWei: bigint;
  traditionalCollateralWei: bigint;
  collateralSavedWei: bigint;
  collateralSavedUSD: bigint;
  // Precomputed display numbers
  borrowAmountUSD: number;
  requiredCollateralETH: number;
  traditionalCollateralETH: number;
  collateralSavedETH: number;
  collateralSavedUSDFormatted: string;
  capitalEfficiencyGain: number; // e.g. 30.0%
  aprPercent?: number; // fixed APR the loan would be originated at
  liqThresholdPercent?: number; // collateral/debt ratio below which the loan can be liquidated
}

export type PersonaId = 'alice' | 'bob' | 'charlie' | 'dana';

export interface BorrowerPersona {
  id: PersonaId | 'wallet';
  name: string;
  title: string;
  tagline: string;
  badge: 'Prime Borrower' | 'High-Risk Degen' | 'Fresh / Moderate' | 'One Late Payment' | 'Your Wallet';
  score: number;
  tier: 'Subprime' | 'Moderate' | 'Near-Prime' | 'Prime';
  tierNumber: RiskTierType;
  collateralRatioBps: number;
  ratioLabel: string;
  metrics: BorrowerMetrics;
  factors: FactorBreakdown;
  profile?: PersonaProfile; // raw model inputs (sandbox personas)
  mockAddress: `0x${string}`;
  activeLoans: {
    loanId: number;
    amountUSDG: number;
    collateralLockedETH: number;
    debtUSD?: number; // live: principal + accrued interest
    aprPercent?: number; // live: fixed APR at origination
    dueDateFormatted: string;
    status: 'Active' | 'Repaid' | 'Liquidated';
  }[];
}
