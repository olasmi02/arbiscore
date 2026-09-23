// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArbiScoreModel
 * @notice Solidity port of the ArbiScore v2 credit model, bit-for-bit identical to the
 * Rust/Stylus engine (contracts/stylus_score/src/scoring.rs) and frontend/lib/scoring/model.ts.
 * Written as a fair EVM baseline: optimizer on, `unchecked` wherever bounds are proven
 * (all intermediates stay far below 2^256; every subtraction is guarded).
 */
library ArbiScoreModel {
    uint256 internal constant S = 1e6;
    uint256 internal constant LN2 = 693_147;
    uint256 internal constant LOG2E = 1_442_695;
    uint256 internal constant DAY = 86_400;

    uint16 internal constant MIN_SCORE = 300;
    uint16 internal constant MAX_SCORE = 850;
    uint256 internal constant MAX_HISTORY = 64;
    uint256 internal constant LOAN_TERM_DAYS = 30;

    uint8 internal constant LOAN_OPEN = 0;
    uint8 internal constant LOAN_REPAID = 1;
    uint8 internal constant LOAN_LIQUIDATED = 2;

    uint256 private constant HALF_LIFE_DAYS = 180;
    uint256 private constant LATE_HALF_DAYS = 15;
    uint256 private constant SEASON_SECS = 14 * DAY;
    uint256 private constant PRIOR_WEIGHT = 30 * S;
    uint256 private constant PRIOR_QUALITY = 600_000;
    uint256 private constant DEPTH_HALF = 100 * S;
    uint256 private constant LIQ_HALF = 60 * S;
    uint256 private constant AGE_HALF_DAYS = 180;
    uint256 private constant TX_HALF = 50;
    uint256 private constant VOL_HALF = 5_000;
    uint256 private constant UTIL_FLOOR = 1_000;

    // Logistic coefficients, fitted to Aave V3 Arbitrum One outcomes with product guardrails (research/fit-weights)
    uint256 private constant C_QUALITY = 1_900_000;
    uint256 private constant C_DEPTH = 2_500_000;
    uint256 private constant C_AGE = 700_000;
    uint256 private constant C_ACTIVITY = 600_000;
    uint256 private constant C_VOLUME = 600_000;
    uint256 private constant C_INTERCEPT_NEG = 1_600_000;
    uint256 private constant C_LIQUIDATION_NEG = 3_500_000;
    uint256 private constant C_UTILIZATION_NEG = 400_000;

    struct Loan {
        uint64 amountUsd;
        uint64 borrowTs;
        uint64 dueTs;
        uint64 closeTs;
        uint8 status;
    }

    struct Acc {
        uint256 w;
        uint256 g;
        uint256 l;
        uint256 openPrincipal;
        uint256 maxRepaid;
    }

    function exp2Neg(uint256 x) internal pure returns (uint256) {
        unchecked {
            uint256 n = x / S;
            if (n >= 64) return 0;
            uint256 y = ((x % S) * LN2) / S;
            uint256 term = S;
            uint256 sum = S;
            for (uint256 k = 1; k <= 10; ++k) {
                term = (term * y) / (S * k);
                if (k % 2 == 1) sum -= term;
                else sum += term;
            }
            return sum >> n;
        }
    }

    function isqrt(uint256 n) internal pure returns (uint256) {
        unchecked {
            if (n < 2) return n;
            uint256 x = n;
            uint256 y = (x + 1) / 2;
            while (y < x) {
                x = y;
                y = (x + n / x) / 2;
            }
            return x;
        }
    }

    function _sat(uint256 x, uint256 half) private pure returns (uint256) {
        unchecked {
            uint256 d = x + half;
            return d == 0 ? 0 : (x * S) / d;
        }
    }

    function _sigmoidPos(uint256 z) private pure returns (uint256) {
        unchecked {
            uint256 e = exp2Neg((z * LOG2E) / S);
            return (S * S) / (S + e);
        }
    }

    function add(Acc memory acc, Loan memory loan, uint256 nowTs) internal pure {
        addWithHalfLife(acc, loan, nowTs, HALF_LIFE_DAYS);
    }

    /// Same as `add`, with a configurable recency half-life (used by the benchmark ensemble).
    function addWithHalfLife(Acc memory acc, Loan memory loan, uint256 nowTs, uint256 halfLifeDays) internal pure {
        unchecked {
            uint256 amount = loan.amountUsd;
            uint256 refTs;
            if (loan.status == LOAN_OPEN) {
                acc.openPrincipal += amount;
                if (nowTs <= loan.dueTs) {
                    return;
                }
                // Overdue and unpaid: a current default, so it doesn't fade while it stays unpaid
                refTs = nowTs;
            } else {
                refTs = loan.closeTs;
            }

            uint256 ageFp = nowTs > refTs ? ((nowTs - refTs) * S) / DAY : 0;
            uint256 recency = exp2Neg(ageFp / halfLifeDays);
            uint256 size = isqrt(amount);
            if (size == 0) size = 1;
            uint256 w = recency * size;
            if (loan.status == LOAN_REPAID) {
                // Seasoning: evidence scales with time outstanding, so instant borrow/repay loops earn nothing.
                uint256 held = loan.closeTs > loan.borrowTs ? uint256(loan.closeTs) - loan.borrowTs : 0;
                w = (w * (held < SEASON_SECS ? held : SEASON_SECS)) / SEASON_SECS;
            }
            acc.w += w;

            if (loan.status == LOAN_REPAID) {
                uint256 lateFp = loan.closeTs > loan.dueTs ? ((uint256(loan.closeTs) - loan.dueTs) * S) / DAY : 0;
                uint256 outcome = lateFp == 0 ? S : exp2Neg(lateFp / LATE_HALF_DAYS);
                acc.g += (w * outcome) / S;
                if (amount > acc.maxRepaid) acc.maxRepaid = amount;
            } else {
                // Liquidated, or open past its due date: full default weight
                acc.l += w;
            }
        }
    }

    function finish(Acc memory acc, uint256 firstActivityTs, uint256 totalTxs, uint256 volumeUsd, uint256 nowTs)
        internal
        pure
        returns (uint16)
    {
        unchecked {
            uint256 ageDaysFp = firstActivityTs > 0 && nowTs > firstActivityTs ? ((nowTs - firstActivityTs) * S) / DAY : 0;
            if (volumeUsd > type(uint64).max) volumeUsd = type(uint64).max;

            uint256 quality = ((acc.g + (PRIOR_WEIGHT * PRIOR_QUALITY) / S) * S) / (acc.w + PRIOR_WEIGHT);
            uint256 pos = (C_QUALITY * quality + C_DEPTH * _sat(acc.w, DEPTH_HALF)
                + C_AGE * _sat(ageDaysFp, AGE_HALF_DAYS * S) + C_ACTIVITY * _sat(totalTxs, TX_HALF)
                + C_VOLUME * _sat(volumeUsd, VOL_HALF)) / S;
            uint256 neg = C_INTERCEPT_NEG
                + (C_LIQUIDATION_NEG * _sat(acc.l, LIQ_HALF)
                    + C_UTILIZATION_NEG * _sat(acc.openPrincipal, acc.maxRepaid + UTIL_FLOOR)) / S;

            uint256 p = pos >= neg ? _sigmoidPos(pos - neg) : S - _sigmoidPos(neg - pos);
            uint256 score = MIN_SCORE + (uint256(MAX_SCORE - MIN_SCORE) * p) / S;
            return uint16(score > MAX_SCORE ? MAX_SCORE : score);
        }
    }

    function computeScore(
        uint256 firstActivityTs,
        uint256 totalTxs,
        uint256 volumeUsd,
        Loan[] memory loans,
        uint256 nowTs
    ) internal pure returns (uint16) {
        Acc memory acc;
        uint256 start = loans.length > MAX_HISTORY ? loans.length - MAX_HISTORY : 0;
        for (uint256 i = start; i < loans.length; ++i) {
            add(acc, loans[i], nowTs);
        }
        return finish(acc, firstActivityTs, totalTxs, volumeUsd, nowTs);
    }

    /// Benchmark "richer model": averages the score over `horizons` recency half-lives.
    function scoreEnsemble(
        uint256 firstActivityTs,
        uint256 totalTxs,
        uint256 volumeUsd,
        Loan[] memory loans,
        uint256 nowTs,
        uint256 horizons
    ) internal pure returns (uint16) {
        if (horizons == 0) return MIN_SCORE;
        uint256 start = loans.length > MAX_HISTORY ? loans.length - MAX_HISTORY : 0;
        uint256 sum;
        for (uint256 h = 0; h < horizons; ++h) {
            Acc memory acc;
            for (uint256 i = start; i < loans.length; ++i) {
                addWithHalfLife(acc, loans[i], nowTs, 60 + 30 * h);
            }
            sum += finish(acc, firstActivityTs, totalTxs, volumeUsd, nowTs);
        }
        return uint16(sum / horizons);
    }

    function specToLoan(uint256 amountUsd, uint256 borrowedDaysAgo, uint8 status, uint256 daysLate, uint256 nowTs)
        internal
        pure
        returns (Loan memory l)
    {
        uint256 back = borrowedDaysAgo * DAY;
        uint256 borrowTs = nowTs > back ? nowTs - back : 0;
        uint256 dueTs = borrowTs + LOAN_TERM_DAYS * DAY;
        uint256 closeTs;
        if (status != LOAN_OPEN) {
            closeTs = dueTs + daysLate * DAY;
            if (closeTs > nowTs) closeTs = nowTs;
        }
        l = Loan(uint64(amountUsd), uint64(borrowTs), uint64(dueTs), uint64(closeTs), status);
    }

    function scoreToTier(uint16 score) internal pure returns (uint8 tier, uint16 ratioBps) {
        if (score >= 750) return (3, 10500);
        if (score >= 680) return (2, 11500);
        if (score >= 600) return (1, 13000);
        return (0, 15000);
    }
}
