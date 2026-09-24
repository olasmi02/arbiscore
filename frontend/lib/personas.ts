import { BorrowerPersona, PersonaId } from './types.ts';
import { scoreToTier } from './math.ts';
import { evaluateProfile } from './scoring/evaluate.ts';
import { LOAN_LIQUIDATED, LOAN_OPEN, LOAN_TERM_DAYS, type LoanSpec } from './scoring/model.ts';
import { PERSONA_PROFILES, type PersonaProfile } from './scoring/personaProfiles.ts';

/** A persona loan; loans with collateral are shown as positions in the sandbox. */
export interface SandboxLoan extends LoanSpec {
  positionId?: number;
  collateralLockedETH?: number;
}

export interface PersonaMeta {
  id: PersonaId;
  name: string;
  title: string;
  tagline: string;
  badge: BorrowerPersona['badge'];
  mockAddress: `0x${string}`;
  depositedETH: number;
}

export const PERSONA_META: Record<PersonaId, PersonaMeta> = {
  alice: {
    id: 'alice',
    name: 'Alice Institutional Prime',
    title: 'Institutional Grade',
    tagline: '8 on-time repayments growing from $2k to $15k over 18 months',
    badge: 'Prime Borrower',
    mockAddress: '0xa11ce00000000000000000000000000000000001',
    depositedETH: 10.0,
  },
  bob: {
    id: 'bob',
    name: 'Bob High-Risk Degen',
    title: 'High-Risk Profile',
    tagline: 'Active trader with 2 liquidations in the last 6 months and late repayments',
    badge: 'High-Risk Degen',
    mockAddress: '0xb0b0000000000000000000000000000000000002',
    depositedETH: 3.0,
  },
  charlie: {
    id: 'charlie',
    name: 'Charlie Fresh Wallet',
    title: 'Emerging Builder',
    tagline: 'One small on-time repayment, now carrying a 6x larger loan; ripe for tier elevation',
    badge: 'Fresh / Moderate',
    mockAddress: '0xca711e0000000000000000000000000000000003',
    depositedETH: 5.0,
  },
};

/** Collateral locked by each persona's currently open loan (matches its tier at origination). */
const OPEN_LOAN_COLLATERAL_ETH: Record<PersonaId, number> = { alice: 3.5, bob: 1.0417, charlie: 1.9667 };

export function initialPersonaLoans(id: PersonaId): SandboxLoan[] {
  return PERSONA_PROFILES[id].loans.map((l, i) =>
    l.status === LOAN_OPEN ? { ...l, positionId: 101 + i, collateralLockedETH: OPEN_LOAN_COLLATERAL_ETH[id] } : l
  );
}

/** Days after the due date when anyone may liquidate the loan (the vault's GRACE_PERIOD). */
export const GRACE_DAYS = 3;

function dueLabel(borrowedDaysAgo: number): string {
  const days = Number(LOAN_TERM_DAYS) - borrowedDaysAgo;
  if (days >= 0) return `Due in ${days}d`;
  return -days > GRACE_DAYS ? `${-days}d overdue · liquidatable` : `${-days}d overdue`;
}

/** Builds the dashboard view of a persona from its (possibly sandbox-modified) loan history. */
export function buildPersona(id: PersonaId, loans: SandboxLoan[], extraDays = 0): BorrowerPersona {
  const meta = PERSONA_META[id];
  const base = PERSONA_PROFILES[id];
  const profile: PersonaProfile = { ...base, ageDays: base.ageDays + extraDays, loans };
  const { score, factors, metrics } = evaluateProfile(profile);
  const tier = scoreToTier(score);
  return {
    id,
    name: meta.name,
    title: meta.title,
    tagline: meta.tagline,
    badge: meta.badge,
    mockAddress: meta.mockAddress,
    score,
    tier: tier.name,
    tierNumber: tier.tier,
    collateralRatioBps: tier.ratioBps,
    ratioLabel: `${tier.ratioPercent}%`,
    metrics,
    factors,
    profile,
    activeLoans: loans
      .filter((l) => l.positionId !== undefined)
      .map((l) => ({
        loanId: l.positionId!,
        amountUSDG: l.amountUsd,
        collateralLockedETH: l.collateralLockedETH ?? 0,
        // Closed loans show their outcome; only an open loan counts down to (or past) its due date
        dueDateFormatted:
          l.status === LOAN_OPEN
            ? dueLabel(l.borrowedDaysAgo)
            : l.status === LOAN_LIQUIDATED
              ? 'Liquidated'
              : l.daysLate > 0
                ? `Repaid ${l.daysLate}d late`
                : 'Repaid on time',
        status: l.status === LOAN_OPEN ? 'Active' : l.status === LOAN_LIQUIDATED ? 'Liquidated' : 'Repaid',
      })),
  };
}

export const INITIAL_PERSONAS: Record<PersonaId, BorrowerPersona> = {
  alice: buildPersona('alice', initialPersonaLoans('alice')),
  bob: buildPersona('bob', initialPersonaLoans('bob')),
  charlie: buildPersona('charlie', initialPersonaLoans('charlie')),
};
