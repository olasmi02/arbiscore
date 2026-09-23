//! ArbiScore v2 credit model: fixed-point logistic regression over per-loan history.
//!
//! Features (all fixed-point, S = 1.0):
//! - quality:     Beta-smoothed repayment quality over loans, each weighted by
//!                recency (2^(-age/180d)) x size (sqrt(amount)) x seasoning (time outstanding,
//!                full at 14 days); late repayments decay by lateness
//! - depth:       total weighted evidence, saturating
//! - liquidation: weighted liquidations (+ half-weight overdue open loans), saturating
//! - age, activity, volume: wallet longevity / tx count / USD volume, saturating
//! - utilization: open principal relative to largest loan ever repaid
//!
//! score = 300 + 550 * sigmoid(intercept + sum(coef_k * feature_k))
//!
//! Integer-only (no float opcodes allowed in Stylus). Bit-for-bit identical to
//! frontend/lib/scoring/model.ts and contracts/lending_vault/contracts/SolidityScoreEngine.sol.

/// Minimum possible credit score (FICO floor).
pub const MIN_SCORE: u16 = 300;
/// Maximum possible credit score (FICO ceiling).
pub const MAX_SCORE: u16 = 850;
/// Only the most recent loans are scored, bounding gas.
pub const MAX_HISTORY: usize = 64;
/// Most recent liquidations still scored when they're older than the MAX_HISTORY window.
pub const MAX_OLD_LIQUIDATIONS: usize = 16;
/// Highest score while any loan is overdue and unpaid (top of the Subprime tier).
pub const DEFAULT_CAP: u16 = 599;

pub const LOAN_OPEN: u8 = 0;
pub const LOAN_REPAID: u8 = 1;
pub const LOAN_LIQUIDATED: u8 = 2;
pub const LOAN_TERM_DAYS: u64 = 30;
pub const DAY: u64 = 86_400;

const S: u128 = 1_000_000;
const LN2: u128 = 693_147;
const LOG2E: u128 = 1_442_695;

// Hyper-parameters
const HALF_LIFE_DAYS: u128 = 180;
const LATE_HALF_DAYS: u128 = 15;
const SEASON_SECS: u128 = 14 * DAY as u128;
const PRIOR_WEIGHT: u128 = 30 * S;
const PRIOR_QUALITY: u128 = 600_000;
const DEPTH_HALF: u128 = 100 * S;
const LIQ_HALF: u128 = 60 * S;
const AGE_HALF_DAYS: u128 = 180;
const TX_HALF: u128 = 50;
const VOL_HALF: u128 = 5_000;
const UTIL_FLOOR: u128 = 1_000;

// Logistic coefficients (Fitted to Aave V3 Arbitrum One outcomes with product guardrails: research/fit-weights)
// Positive terms
const C_QUALITY: u128 = 1_900_000;
const C_DEPTH: u128 = 2_500_000;
const C_AGE: u128 = 700_000;
const C_ACTIVITY: u128 = 600_000;
const C_VOLUME: u128 = 600_000;
// Logistic coefficients: negative terms (stored as magnitudes)
const C_INTERCEPT_NEG: u128 = 1_600_000;
const C_LIQUIDATION_NEG: u128 = 3_500_000;
const C_UTILIZATION_NEG: u128 = 400_000;

/// Risk tier definitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RiskTier {
    Subprime = 0,  // Score < 600   -> 150% Collateral Ratio (15000 bps)
    Moderate = 1,  // Score 600-679 -> 130% Collateral Ratio (13000 bps)
    NearPrime = 2, // Score 680-749 -> 115% Collateral Ratio (11500 bps)
    Prime = 3,     // Score 750-850 -> 105% Collateral Ratio (10500 bps)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LoanEntry {
    pub amount_usd: u64,
    pub borrow_ts: u64,
    pub due_ts: u64,
    pub close_ts: u64,
    pub status: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Features {
    pub quality: u128,
    pub depth: u128,
    pub liquidation: u128,
    pub age: u128,
    pub activity: u128,
    pub volume: u128,
    pub utilization: u128,
    /// Some loan is open past its due date: the score is capped at Subprime until it's repaid.
    pub in_default: bool,
}

/// 2^(-x) for x >= 0; x and result in fixed-point S.
pub fn exp2_neg(x: u128) -> u128 {
    let n = x / S;
    if n >= 64 {
        return 0;
    }
    let y = ((x % S) * LN2) / S;
    let mut term = S;
    let mut sum = S;
    let mut k: u128 = 1;
    while k <= 10 {
        term = (term * y) / (S * k);
        if k % 2 == 1 {
            sum -= term;
        } else {
            sum += term;
        }
        k += 1;
    }
    sum >> n
}

/// Integer square root (Newton).
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

fn sat(x: u128, half: u128) -> u128 {
    let d = x + half;
    if d == 0 {
        0
    } else {
        (x * S) / d
    }
}

fn sigmoid_pos(z: u128) -> u128 {
    let e = exp2_neg((z * LOG2E) / S);
    (S * S) / (S + e)
}

/// Streaming feature accumulator so the contract can score storage-backed history
/// without first copying it into memory.
#[derive(Default)]
pub struct Accumulator {
    w: u128,
    g: u128,
    l: u128,
    open_principal: u128,
    max_repaid: u128,
    overdue: bool,
}

impl Accumulator {
    pub fn add(&mut self, loan: &LoanEntry, now: u64) {
        self.add_with_half_life(loan, now, HALF_LIFE_DAYS);
    }

    /// Same as `add`, with a configurable recency half-life (used by the benchmark ensemble).
    pub fn add_with_half_life(&mut self, loan: &LoanEntry, now: u64, half_life_days: u128) {
        let amount = loan.amount_usd as u128;
        let ref_ts = if loan.status == LOAN_OPEN {
            self.open_principal += amount;
            if now <= loan.due_ts {
                return;
            }
            // Overdue and unpaid: a current default, so it doesn't fade while it stays unpaid
            self.overdue = true;
            now
        } else {
            loan.close_ts
        };

        let age_fp = if now > ref_ts {
            ((now - ref_ts) as u128 * S) / DAY as u128
        } else {
            0
        };
        let recency = exp2_neg(age_fp / half_life_days);
        let mut size = isqrt(amount);
        if size == 0 {
            size = 1;
        }
        let mut w = recency * size;
        if loan.status == LOAN_REPAID {
            // Seasoning: evidence scales with time outstanding, so instant borrow/repay loops earn nothing.
            let held = if loan.close_ts > loan.borrow_ts { (loan.close_ts - loan.borrow_ts) as u128 } else { 0 };
            w = (w * held.min(SEASON_SECS)) / SEASON_SECS;
        }
        self.w += w;

        if loan.status == LOAN_REPAID {
            let late_fp = if loan.close_ts > loan.due_ts {
                ((loan.close_ts - loan.due_ts) as u128 * S) / DAY as u128
            } else {
                0
            };
            let outcome = if late_fp == 0 { S } else { exp2_neg(late_fp / LATE_HALF_DAYS) };
            self.g += (w * outcome) / S;
            if amount > self.max_repaid {
                self.max_repaid = amount;
            }
        } else {
            // Liquidated, or open past its due date: full default weight
            self.l += w;
        }
    }

    pub fn finish(&self, first_activity_ts: u64, total_txs: u64, volume_usd: u64, now: u64) -> Features {
        let age_days_fp = if first_activity_ts > 0 && now > first_activity_ts {
            ((now - first_activity_ts) as u128 * S) / DAY as u128
        } else {
            0
        };
        Features {
            quality: ((self.g + (PRIOR_WEIGHT * PRIOR_QUALITY) / S) * S) / (self.w + PRIOR_WEIGHT),
            depth: sat(self.w, DEPTH_HALF),
            liquidation: sat(self.l, LIQ_HALF),
            age: sat(age_days_fp, AGE_HALF_DAYS * S),
            activity: sat(total_txs as u128, TX_HALF),
            volume: sat(volume_usd as u128, VOL_HALF),
            utilization: sat(self.open_principal, self.max_repaid + UTIL_FLOOR),
            in_default: self.overdue,
        }
    }
}

pub fn compute_features(
    first_activity_ts: u64,
    total_txs: u64,
    volume_usd: u64,
    loans: &[LoanEntry],
    now: u64,
) -> Features {
    let start = loans.len().saturating_sub(MAX_HISTORY);
    let mut acc = Accumulator::default();
    // Liquidations can't be pushed out of the window with new loans: the most recent
    // MAX_OLD_LIQUIDATIONS liquidations still count even when they're older than it.
    let mut seen = 0;
    for i in (0..loans.len()).rev() {
        if loans[i].status == LOAN_LIQUIDATED {
            seen += 1;
            if seen > MAX_OLD_LIQUIDATIONS {
                break;
            }
            if i < start {
                acc.add(&loans[i], now);
            }
        }
    }
    for loan in &loans[start..] {
        acc.add(loan, now);
    }
    acc.finish(first_activity_ts, total_txs, volume_usd, now)
}

/// Probability of good repayment in fixed-point S.
pub fn probability(f: &Features) -> u128 {
    let pos = (C_QUALITY * f.quality
        + C_DEPTH * f.depth
        + C_AGE * f.age
        + C_ACTIVITY * f.activity
        + C_VOLUME * f.volume)
        / S;
    let neg = C_INTERCEPT_NEG + (C_LIQUIDATION_NEG * f.liquidation + C_UTILIZATION_NEG * f.utilization) / S;
    if pos >= neg {
        sigmoid_pos(pos - neg)
    } else {
        S - sigmoid_pos(neg - pos)
    }
}

pub fn score_from_features(f: &Features) -> u16 {
    let p = probability(f);
    let score = (MIN_SCORE as u128 + ((MAX_SCORE - MIN_SCORE) as u128 * p) / S).min(MAX_SCORE as u128) as u16;
    // No better than Subprime while a loan is overdue and unpaid
    if f.in_default { score.min(DEFAULT_CAP) } else { score }
}

/// Benchmark "richer model": averages the score over `horizons` recency half-lives
/// (60, 90, 120, ... days). Same inputs and storage reads, `horizons` times the arithmetic.
pub fn score_ensemble(
    first_activity_ts: u64,
    total_txs: u64,
    volume_usd: u64,
    loans: &[LoanEntry],
    now: u64,
    horizons: u32,
) -> u16 {
    if horizons == 0 {
        return MIN_SCORE;
    }
    let start = loans.len().saturating_sub(MAX_HISTORY);
    let mut sum: u32 = 0;
    for h in 0..horizons {
        let half_life = 60 + 30 * h as u128;
        let mut acc = Accumulator::default();
        for loan in &loans[start..] {
            acc.add_with_half_life(loan, now, half_life);
        }
        sum += score_from_features(&acc.finish(first_activity_ts, total_txs, volume_usd, now)) as u32;
    }
    (sum / horizons) as u16
}

pub fn compute_score(first_activity_ts: u64, total_txs: u64, volume_usd: u64, loans: &[LoanEntry], now: u64) -> u16 {
    score_from_features(&compute_features(first_activity_ts, total_txs, volume_usd, loans, now))
}

/// Expands a compact sandbox loan spec into a LoanEntry (mirrors model.ts specToEntry).
pub fn spec_to_entry(amount_usd: u64, borrowed_days_ago: u64, status: u8, days_late: u64, now: u64) -> LoanEntry {
    let borrow_ts = now.saturating_sub(borrowed_days_ago.saturating_mul(DAY));
    let due_ts = borrow_ts + LOAN_TERM_DAYS * DAY;
    let close_ts = if status == LOAN_OPEN {
        0
    } else {
        (due_ts + days_late.saturating_mul(DAY)).min(now)
    };
    LoanEntry { amount_usd, borrow_ts, due_ts, close_ts, status }
}

/// Maps a credit score in [300, 850] to a risk tier and collateral ratio in basis points (bps).
pub fn score_to_tier(score: u16) -> (u8, u16) {
    if score >= 750 {
        (RiskTier::Prime as u8, 10500)
    } else if score >= 680 {
        (RiskTier::NearPrime as u8, 11500)
    } else if score >= 600 {
        (RiskTier::Moderate as u8, 13000)
    } else {
        (RiskTier::Subprime as u8, 15000)
    }
}
