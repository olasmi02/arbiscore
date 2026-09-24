/**
 * ArbiScore v2 credit model — TypeScript port.
 *
 * Bit-for-bit identical to the Rust Stylus engine (contracts/stylus_score/src/scoring.rs)
 * and the Solidity reference engine (SolidityScoreEngine.sol). Every operation is unsigned
 * integer math with truncating division, so all three implementations return the same score.
 *
 * Model: fixed-point logistic regression over 7 features, where the repayment features are
 * aggregated from per-loan history with exponential time decay, sqrt(amount) size weighting and
 * seasoning (repaid loans earn full weight only after 14 days outstanding).
 */

export const S = 1_000_000n; // fixed-point scale (1.0)
const LN2 = 693_147n;
const LOG2E = 1_442_695n;
const DAY = 86_400n;
const U64_MAX = (1n << 64n) - 1n;

export const MIN_SCORE = 300n;
export const MAX_SCORE = 850n;
export const MAX_HISTORY = 64;
/** Most recent liquidations still scored when they're older than the MAX_HISTORY window. */
export const MAX_OLD_LIQUIDATIONS = 16;
/** Highest score while any loan is overdue and unpaid (top of the Subprime tier). */
export const DEFAULT_CAP = 599;

export const LOAN_OPEN = 0;
export const LOAN_REPAID = 1;
export const LOAN_LIQUIDATED = 2;

// Model hyper-parameters (fixed-point, S = 1.0)
export const PARAMS = {
  halfLifeDays: 180n, // recency half-life for loan evidence
  lateHalfDays: 5n, // repayment credit halves for every 5 days late; the rest counts as a default
  seasonDays: 14n, // a repaid loan earns full weight only after 14 days outstanding (anti wash-borrowing)
  priorWeight: 30n * S, // Beta-prior strength (≈ one fresh $900 loan)
  priorQuality: 600_000n, // prior repayment quality with no evidence (0.60)
  depthHalf: 100n * S, // evidence weight at which depth feature = 0.5
  liqHalf: 60n * S, // liquidation weight at which liquidation feature = 0.5
  ageHalfDays: 180n, // wallet age at which age feature = 0.5
  txHalf: 50n, // tx count at which activity feature = 0.5
  volHalf: 5_000n, // USD volume at which volume feature = 0.5
  utilFloor: 1_000n, // USD added to repaid capacity in utilization denominator
} as const;

// Logistic regression coefficients (fixed-point). Positive and negative terms are
// accumulated separately so every implementation stays in unsigned arithmetic.
// Fitted to Aave V3 Arbitrum One outcomes with product guardrails: research/fit-weights.
export const COEF = {
  intercept: -1_600_000n,
  quality: 1_900_000n,
  depth: 2_500_000n,
  liquidation: -3_500_000n,
  age: 700_000n,
  activity: 600_000n,
  volume: 600_000n,
  utilization: -400_000n,
} as const;

export interface LoanEntry {
  amountUsd: bigint;
  borrowTs: bigint;
  dueTs: bigint;
  closeTs: bigint; // 0 while open
  status: number; // LOAN_OPEN | LOAN_REPAID | LOAN_LIQUIDATED
}

export interface ModelInput {
  firstActivityTs: bigint;
  totalTxs: bigint;
  volumeUsd: bigint;
  loans: LoanEntry[];
  now: bigint;
}

export interface Features {
  quality: bigint;
  depth: bigint;
  liquidation: bigint;
  age: bigint;
  activity: bigint;
  volume: bigint;
  utilization: bigint;
  /** Some loan is open past its due date: the score is capped at Subprime until it's repaid. */
  inDefault: boolean;
}

/** 2^(-x) for x >= 0, x and result in fixed-point S. */
export function exp2Neg(x: bigint): bigint {
  const n = x / S;
  if (n >= 64n) return 0n;
  const y = ((x % S) * LN2) / S; // frac * ln2, in [0, 0.694)
  let term = S;
  let sum = S;
  for (let k = 1n; k <= 10n; k++) {
    term = (term * y) / (S * k);
    sum = k % 2n === 1n ? sum - term : sum + term;
  }
  return sum >> n;
}

/** Integer square root (Newton), identical iteration order across implementations. */
export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** x / (x + half) in fixed-point S: a saturating curve that equals 0.5 at x = half. */
function sat(x: bigint, half: bigint): bigint {
  const d = x + half;
  return d === 0n ? 0n : (x * S) / d;
}

/** sigmoid(z) for z >= 0 in fixed-point S. */
function sigmoidPos(z: bigint): bigint {
  const e = exp2Neg((z * LOG2E) / S);
  return (S * S) / (S + e);
}

export function computeFeatures(input: ModelInput): Features {
  const { now, loans } = input;
  let W = 0n;
  let G = 0n;
  let L = 0n;
  let overdueW = 0n; // loans still open past their due date: a default, so they add no depth
  let openPrincipal = 0n;
  let maxRepaid = 0n;
  let overdue = false;

  const start = loans.length > MAX_HISTORY ? loans.length - MAX_HISTORY : 0;
  // Liquidations can't be pushed out of the window with new loans: the most recent
  // MAX_OLD_LIQUIDATIONS liquidations still count even when they're older than it.
  const scored: LoanEntry[] = [];
  let seen = 0;
  for (let i = loans.length - 1; i >= 0; i--) {
    if (loans[i].status !== LOAN_LIQUIDATED) continue;
    if (++seen > MAX_OLD_LIQUIDATIONS) break;
    if (i < start) scored.push(loans[i]);
  }
  for (let i = start; i < loans.length; i++) scored.push(loans[i]);

  for (const loan of scored) {
    let refTs: bigint;
    if (loan.status === LOAN_OPEN) {
      openPrincipal += loan.amountUsd;
      if (now <= loan.dueTs) continue;
      overdue = true;
      refTs = now; // overdue and unpaid: a current default, so it doesn't fade while it stays unpaid
    } else {
      refTs = loan.closeTs;
    }

    const ageFp = now > refTs ? ((now - refTs) * S) / DAY : 0n;
    const recency = exp2Neg(ageFp / PARAMS.halfLifeDays);
    let size = isqrt(loan.amountUsd);
    if (size === 0n) size = 1n;
    let w = recency * size;
    if (loan.status === LOAN_REPAID) {
      // Seasoning: repayment evidence scales with time outstanding, so instant borrow/repay loops earn nothing.
      const held = loan.closeTs > loan.borrowTs ? loan.closeTs - loan.borrowTs : 0n;
      const season = PARAMS.seasonDays * DAY;
      w = (w * (held < season ? held : season)) / season;
    }
    W += w;

    if (loan.status === LOAN_REPAID) {
      const lateFp = loan.closeTs > loan.dueTs ? ((loan.closeTs - loan.dueTs) * S) / DAY : 0n;
      const outcome = lateFp === 0n ? S : exp2Neg(lateFp / PARAMS.lateHalfDays);
      const good = (w * outcome) / S;
      G += good;
      L += w - good; // the late part counts as a default
      if (loan.amountUsd > maxRepaid) maxRepaid = loan.amountUsd;
    } else {
      L += w; // liquidated, or open past its due date: full default weight
      if (loan.status === LOAN_OPEN) overdueW += w;
    }
  }

  const ageDaysFp =
    input.firstActivityTs > 0n && now > input.firstActivityTs
      ? ((now - input.firstActivityTs) * S) / DAY
      : 0n;

  return {
    quality: ((G + (PARAMS.priorWeight * PARAMS.priorQuality) / S) * S) / (W + PARAMS.priorWeight),
    depth: sat(W - overdueW, PARAMS.depthHalf),
    liquidation: sat(L, PARAMS.liqHalf),
    age: sat(ageDaysFp, PARAMS.ageHalfDays * S),
    activity: sat(input.totalTxs, PARAMS.txHalf),
    volume: sat(input.volumeUsd > U64_MAX ? U64_MAX : input.volumeUsd, PARAMS.volHalf),
    utilization: sat(openPrincipal, maxRepaid + PARAMS.utilFloor),
    inDefault: overdue,
  };
}

/** Probability of good repayment (fixed-point S) from features. */
export function probabilityFromFeatures(f: Features): bigint {
  // Split the linear predictor into positive and negative parts (unsigned math).
  const pos =
    (COEF.quality * f.quality +
      COEF.depth * f.depth +
      COEF.age * f.age +
      COEF.activity * f.activity +
      COEF.volume * f.volume) /
    S;
  const neg =
    -COEF.intercept +
    (-COEF.liquidation * f.liquidation + -COEF.utilization * f.utilization) / S;
  return pos >= neg ? sigmoidPos(pos - neg) : S - sigmoidPos(neg - pos);
}

export function scoreFromFeatures(f: Features): number {
  const p = probabilityFromFeatures(f);
  const raw = MIN_SCORE + ((MAX_SCORE - MIN_SCORE) * p) / S;
  const score = Number(raw > MAX_SCORE ? MAX_SCORE : raw);
  // No better than Subprime while a loan is overdue and unpaid
  return f.inDefault ? Math.min(score, DEFAULT_CAP) : score;
}

export function computeScore(input: ModelInput): number {
  return scoreFromFeatures(computeFeatures(input));
}

// ---------------------------------------------------------------------------
// Persona / sandbox helpers
// ---------------------------------------------------------------------------

export const LOAN_TERM_DAYS = 30n;

/** Compact loan description used by personas and the on-chain setMockProfile call. */
export interface LoanSpec {
  amountUsd: number;
  borrowedDaysAgo: number;
  status: number;
  daysLate: number;
}

/** Expands a LoanSpec into a LoanEntry exactly like the engine's set_mock_profile. */
export function specToEntry(spec: LoanSpec, now: bigint): LoanEntry {
  const back = BigInt(spec.borrowedDaysAgo) * DAY;
  const borrowTs = now > back ? now - back : 0n;
  const dueTs = borrowTs + LOAN_TERM_DAYS * DAY;
  let closeTs = 0n;
  if (spec.status !== LOAN_OPEN) {
    closeTs = dueTs + BigInt(spec.daysLate) * DAY;
    if (closeTs > now) closeTs = now;
  }
  return { amountUsd: BigInt(spec.amountUsd), borrowTs, dueTs, closeTs, status: spec.status };
}

export type ScoredFeature = Exclude<keyof Features, 'inDefault'>;

/**
 * Leave-one-out attribution: score points each feature adds vs. a neutral value. Computed on the
 * uncapped model; the default cap is reported separately (Features.inDefault).
 */
export function featureImpacts(f: Features): Record<ScoredFeature, number> {
  const uncapped = { ...f, inDefault: false };
  const base = scoreFromFeatures(uncapped);
  const neutral: Omit<Features, 'inDefault'> = {
    quality: PARAMS.priorQuality,
    depth: 0n,
    liquidation: 0n,
    age: 0n,
    activity: 0n,
    volume: 0n,
    utilization: 0n,
  };
  const out = {} as Record<ScoredFeature, number>;
  for (const k of Object.keys(neutral) as ScoredFeature[]) {
    out[k] = base - scoreFromFeatures({ ...uncapped, [k]: neutral[k] });
  }
  return out;
}
