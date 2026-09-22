import {
  computeFeatures,
  featureImpacts,
  probabilityFromFeatures,
  scoreFromFeatures,
  specToEntry,
  LOAN_OPEN,
  LOAN_REPAID,
  LOAN_LIQUIDATED,
  S,
  type Features,
  type LoanEntry,
  type ModelInput,
} from './model.ts';
import type { PersonaProfile } from './personaProfiles.ts';
import type { BorrowerMetrics, FactorBreakdown } from '../types.ts';

const DAY = 86_400n;

export interface Evaluation {
  score: number;
  factors: FactorBreakdown;
  metrics: BorrowerMetrics;
}

const toUnit = (f: Features) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v) / Number(S)])) as FactorBreakdown['features'];

/** Runs the ArbiScore model and summarizes the result for the UI. */
export function evaluate(input: ModelInput): Evaluation {
  const f = computeFeatures(input);
  const { now, loans } = input;
  const count = (pred: (l: LoanEntry) => boolean) => loans.filter(pred).length;
  const ageDays =
    input.firstActivityTs > 0n && now > input.firstActivityTs ? Number((now - input.firstActivityTs) / DAY) : 0;
  const repaidOnTime = count((l) => l.status === LOAN_REPAID && l.closeTs <= l.dueTs);
  const repaidLate = count((l) => l.status === LOAN_REPAID && l.closeTs > l.dueTs);
  const liquidations = count((l) => l.status === LOAN_LIQUIDATED);

  return {
    score: scoreFromFeatures(f),
    factors: {
      probability: Number(probabilityFromFeatures(f)) / Number(S),
      impacts: featureImpacts(f),
      features: toUnit(f),
      repaidOnTime,
      repaidLate,
      liquidations,
      delinquent: count((l) => l.status === LOAN_OPEN && now > l.dueTs),
      openLoans: count((l) => l.status === LOAN_OPEN && now <= l.dueTs),
      ageDays,
      txCount: Number(input.totalTxs),
      volumeUSD: Number(input.volumeUsd),
    },
    metrics: {
      ageDays,
      totalTransactions: Number(input.totalTxs),
      totalVolumeUSD: Number(input.volumeUsd),
      loansTaken: loans.length,
      loansRepaid: repaidOnTime + repaidLate,
      liquidations,
    },
  };
}

/** Evaluates a sandbox persona profile. Scores depend only on relative times, so `now` is arbitrary. */
export function evaluateProfile(profile: PersonaProfile, now = BigInt(Math.floor(Date.now() / 1000))): Evaluation {
  return evaluate({
    firstActivityTs: now - BigInt(profile.ageDays) * DAY,
    totalTxs: BigInt(profile.totalTransactions),
    volumeUsd: BigInt(profile.totalVolumeUSD),
    loans: profile.loans.map((l) => specToEntry(l, now)),
    now,
  });
}
