'use client';

import React from 'react';
import { GaugeMath, scoreToTier } from '@/lib/math';

interface ScoreGaugeProps {
  score: number;
  /** The engine has never seen this wallet: show "no score yet" instead of the 300 placeholder. */
  unscored?: boolean;
}

export function ScoreGauge({ score, unscored = false }: ScoreGaugeProps) {
  const clampedScore = Math.max(300, Math.min(850, score));
  const angle = GaugeMath.scoreToAngle(clampedScore);
  const tier = scoreToTier(clampedScore);

  // SVG Geometry: Center (140, 135), Radius 95, Stroke 14
  // Semi-circle spans 180 degrees from (45, 135) to (235, 135)
  // Subprime arc (300 to 600, theta -90 to +8.18):
  // Moderate arc (600 to 680, theta +8.18 to +34.36):
  // Near-Prime arc (680 to 750, theta +34.36 to +57.27):
  // Prime arc (750 to 850, theta +57.27 to +90.00):

  return (
    <div className="flex flex-col items-center justify-center relative w-full select-none">
      <div className="relative w-full max-w-[320px] aspect-[280/160]">
        <svg
          viewBox="0 0 280 160"
          className="w-full h-full overflow-visible"
        >
          {/* Background Track */}
          <path
            d="M 45.00 135.00 A 95 95 0 0 1 235.00 135.00"
            fill="none"
            stroke="#18181b"
            strokeWidth="16"
            strokeLinecap="round"
          />

          {/* Subprime Arc (300 -> 600) */}
          <path
            d="M 45.00 135.00 A 95 95 0 0 1 153.52 40.97"
            fill="none"
            stroke="#ef4444"
            strokeWidth="14"
            strokeLinecap="round"
            className="transition-opacity duration-300"
            opacity={tier.name === 'Subprime' ? 1 : 0.35}
          />

          {/* Moderate Arc (600 -> 680) */}
          <path
            d="M 153.52 40.97 A 95 95 0 0 1 193.62 56.58"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="14"
            className="transition-opacity duration-300"
            opacity={tier.name === 'Moderate' ? 1 : 0.35}
          />

          {/* Near-Prime Arc (680 -> 750) */}
          <path
            d="M 193.62 56.58 A 95 95 0 0 1 219.92 83.64"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="14"
            className="transition-opacity duration-300"
            opacity={tier.name === 'Near-Prime' ? 1 : 0.35}
          />

          {/* Prime Arc (750 -> 850) */}
          <path
            d="M 219.92 83.64 A 95 95 0 0 1 235.00 135.00"
            fill="none"
            stroke="#10b981"
            strokeWidth="14"
            strokeLinecap="round"
            className="transition-opacity duration-300"
            opacity={tier.name === 'Prime' ? 1 : 0.35}
          />

          {/* Needle - Tapered fintech polygon centered at (140, 135) */}
          <g
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: '140px 135px',
              transition: 'transform 800ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {/* Tapered needle pointer pointing up towards 140, 55 */}
            {!unscored && (
              <polygon
                points="137,135 143,135 140,55"
                fill="#fafafa"
                filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"
              />
            )}
            {/* Outer Pivot Cap Hub */}
            <circle
              cx="140"
              cy="135"
              r="8"
              fill="#18181b"
              stroke="#27272a"
              strokeWidth="2"
            />
            {/* Inner Tier Indicator Core */}
            <circle
              cx="140"
              cy="135"
              r="4"
              fill={tier.badgeColor}
              className="transition-colors duration-300"
            />
          </g>

          {/* Scale Labels */}
          <text
            x="36"
            y="154"
            fill="#71717a"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
          >
            300
          </text>
          <text
            x="140"
            y="26"
            fill="#71717a"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
          >
            575
          </text>
          <text
            x="244"
            y="154"
            fill="#71717a"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
          >
            850
          </text>
        </svg>

      </div>

      {/* Live readout, below the dial so the needle never covers it */}
      <div className="mt-2 flex flex-col items-center justify-center text-center">
          <div className="text-4xl font-extrabold tracking-tight text-white font-mono tabular-nums leading-none">
            {unscored ? '—' : clampedScore}
          </div>
          <div className="text-[11px] font-mono text-zinc-400 mt-1 uppercase tracking-widest">
            {unscored ? 'No score yet · market terms (125%)' : 'Credit Score'}
          </div>
      </div>
    </div>
  );
}
