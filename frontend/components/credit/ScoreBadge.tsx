import React from 'react';
import { scoreToTier } from '@/lib/math';
import clsx from 'clsx';

interface ScoreBadgeProps {
  score: number;
  className?: string;
  /** Replaces the tier name, e.g. for a wallet the engine has never scored. */
  label?: string;
}

export function ScoreBadge({ score, className, label }: ScoreBadgeProps) {
  const tier = scoreToTier(score);

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono font-medium tracking-tight shadow-sm',
        tier.bgLight,
        tier.borderColor,
        className
      )}
      style={{ color: tier.badgeColor }}
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: tier.badgeColor }}
      />
      <span className="font-semibold uppercase tracking-wider">{label ?? tier.name}</span>
      <span className="text-zinc-500">•</span>
      <span className="tabular-nums font-bold">{tier.ratioPercent}% Collateral Ratio</span>
    </div>
  );
}
