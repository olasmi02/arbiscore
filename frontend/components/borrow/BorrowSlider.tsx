'use client';

import React from 'react';
import clsx from 'clsx';
import { DollarSign } from 'lucide-react';

interface BorrowSliderProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  symbol?: string;
  max?: number;
  step?: number;
}

const PRESET_PILLS = [500, 2500, 10000, 25000];

export function BorrowSlider({
  value,
  onChange,
  min = 100,
  symbol = 'USDG',
  max = 50000,
  step = 50,
}: BorrowSliderProps) {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    if (isNaN(raw)) return;
    const clamped = Math.max(min, Math.min(max, raw));
    onChange(clamped);
  };

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <label className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
          Desired Borrow Amount ({symbol})
        </label>
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {(max <= 1_000 ? [1, 5, 10, 25, 50, 100] : PRESET_PILLS).filter((p) => p >= min && p <= max).map((pill) => (
            <button
              key={pill}
              type="button"
              onClick={() => onChange(pill)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-xs font-mono transition-all border',
                value === pill
                  ? 'bg-white text-zinc-950 font-bold border-white shadow-sm'
                  : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border-zinc-800 hover:border-zinc-700'
              )}
            >
              ${pill.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {/* Numerical Display Input with Prefix */}
      <div className="relative flex items-center">
        <div className="absolute left-3.5 pointer-events-none text-zinc-500 font-mono text-lg font-semibold">
          $
        </div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleInputChange}
          className="w-full pl-8 pr-16 py-3 rounded-xl bg-zinc-950/80 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-2xl font-bold font-mono text-white tabular-nums transition-colors"
        />
        <div className="absolute right-3.5 pointer-events-none text-zinc-500 font-mono text-xs font-semibold">
          {symbol}
        </div>
      </div>

      {/* Range Slider Track */}
      <div className="space-y-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
          style={{
            background: `linear-gradient(to right, #10b981 ${percentage}%, #27272a ${percentage}%)`,
          }}
        />
        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 tabular-nums">
          <span>Min: ${min.toLocaleString()}</span>
          <span>{max <= 1_000 ? 'Limited by pool liquidity' : '$10,000 (Default)'}</span>
          <span>Max: ${max.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
