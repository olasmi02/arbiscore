import { MIN_SCORE, MAX_SCORE, RiskTier, type RiskTierInfo, type BorrowQuote } from './types.ts';

export function scoreToTier(score: number): RiskTierInfo {
  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
  if (clamped >= 750) {
    return {
      tier: RiskTier.Prime,
      name: 'Prime',
      ratioBps: 10500,
      ratioPercent: 105,
      badgeColor: '#10b981',
      bgLight: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/30',
    };
  } else if (clamped >= 680) {
    return {
      tier: RiskTier.NearPrime,
      name: 'Near-Prime',
      ratioBps: 11500,
      ratioPercent: 115,
      badgeColor: '#38bdf8',
      bgLight: 'bg-sky-500/10',
      borderColor: 'border-sky-500/30',
    };
  } else if (clamped >= 600) {
    return {
      tier: RiskTier.Moderate,
      name: 'Moderate',
      ratioBps: 13000,
      ratioPercent: 130,
      badgeColor: '#f59e0b',
      bgLight: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
    };
  } else {
    return {
      tier: RiskTier.Subprime,
      name: 'Subprime',
      ratioBps: 15000,
      ratioPercent: 150,
      badgeColor: '#ef4444',
      bgLight: 'bg-rose-500/10',
      borderColor: 'border-rose-500/30',
    };
  }
}

export const GaugeMath = {
  scoreToAngle(score: number): number {
    const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
    // -90 deg at 300, 0 deg at 575, +90 deg at 850
    return -90 + ((clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 180;
  },

  arcPercentage(score: number): number {
    const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
    return (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
  },

  needleCoordinates(
    score: number,
    cx: number,
    cy: number,
    radius: number
  ): { x: number; y: number } {
    const angleDeg = GaugeMath.scoreToAngle(score);
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  },
};

export function calculateBorrowQuote(
  borrowAmountUSD: number,
  score: number,
  ethPriceUSD: number = 3000,
  limits: { min: number; max: number } = { min: 100, max: 50000 }
): BorrowQuote {
  const clampedBorrow = Math.max(limits.min, Math.min(limits.max, Math.round(borrowAmountUSD)));
  const tierInfo = scoreToTier(score);
  const requiredRatioBps = BigInt(tierInfo.ratioBps);
  const traditionalRatioBps = 15000n; // 150%

  // BigInt math matching smart contract ArbiCreditVault.sol
  const borrowUSDG = BigInt(clampedBorrow) * 1_000_000n; // 6 decimals
  // Price in 18-decimal USD (Chainlink prices are fractional), as the vault's oracle returns it
  const price18 = BigInt(Math.round(ethPriceUSD * 1e6)) * 10n ** 12n;

  // Same rounding as ArbiCreditVault._collateralFor (up) and getBorrowQuote (nearest USD)
  const collateralFor = (ratioBps: bigint) => {
    const num = borrowUSDG * 10n ** 12n * ratioBps * 10n ** 18n;
    const den = 10000n * price18;
    return (num + den - 1n) / den;
  };
  const requiredCollateralWei = collateralFor(requiredRatioBps);
  const traditionalCollateralWei = collateralFor(traditionalRatioBps);

  const collateralSavedWei =
    traditionalCollateralWei > requiredCollateralWei
      ? traditionalCollateralWei - requiredCollateralWei
      : 0n;

  const collateralSavedUSD = (collateralSavedWei * price18 + 5n * 10n ** 35n) / 10n ** 36n;

  // Floating point representations for high-fidelity UI display
  const requiredCollateralETH = Number(requiredCollateralWei) / 1e18;
  const traditionalCollateralETH = Number(traditionalCollateralWei) / 1e18;
  const collateralSavedETH = Number(collateralSavedWei) / 1e18;

  const savedUSDNumber = Number(collateralSavedUSD);
  const collateralSavedUSDFormatted = `$${savedUSDNumber.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const capitalEfficiencyGain =
    traditionalCollateralETH > 0
      ? (collateralSavedETH / traditionalCollateralETH) * 100
      : 0;

  return {
    score,
    tier: tierInfo.tier,
    tierName: tierInfo.name,
    requiredRatioBps: tierInfo.ratioBps,
    requiredRatioPercent: tierInfo.ratioPercent,
    requiredCollateralWei,
    traditionalCollateralWei,
    collateralSavedWei,
    collateralSavedUSD,
    borrowAmountUSD: clampedBorrow,
    requiredCollateralETH,
    traditionalCollateralETH,
    collateralSavedETH,
    collateralSavedUSDFormatted,
    capitalEfficiencyGain,
  };
}

export function formatUSD(amount: number): string {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatETH(amount: number, decimals: number = 4): string {
  return `${amount.toFixed(decimals)} ETH`;
}
