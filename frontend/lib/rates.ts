/**
 * TypeScript mirror of ArbiCreditVault.quoteAprBps: kinked utilization curve + tier risk premium.
 * Used to preview a loan's fixed APR before it is originated.
 */
const BASE_RATE_BPS = 200;
const SLOPE1_BPS = 1_000;
const SLOPE2_BPS = 6_000;
const KINK_BPS = 8_000;
const TIER_PREMIUM_BPS = [500, 300, 150, 0]; // Subprime, Moderate, Near-Prime, Prime

export function quoteAprBps(tier: number, amountUSD: number, totalAssetsUSD: number, totalPrincipalUSD: number): number {
  const u =
    totalAssetsUSD <= 0 ? 10_000 : Math.min(10_000, Math.floor(((totalPrincipalUSD + amountUSD) * 10_000) / totalAssetsUSD));
  const rate =
    u <= KINK_BPS
      ? BASE_RATE_BPS + Math.floor((u * SLOPE1_BPS) / KINK_BPS)
      : BASE_RATE_BPS + SLOPE1_BPS + Math.floor(((u - KINK_BPS) * SLOPE2_BPS) / (10_000 - KINK_BPS));
  return rate + TIER_PREMIUM_BPS[Math.max(0, Math.min(3, tier))];
}

/** Liquidation threshold per tier (collateral / debt), mirrors ArbiCreditVault.liquidationThresholdBps. */
export function liquidationThresholdPercent(tier: number): number {
  return [119, 113, 108, 103][Math.max(0, Math.min(3, tier))];
}
