import React from 'react';
import clsx from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'prime' | 'nearprime' | 'moderate' | 'subprime' | 'neutral' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'neutral', size = 'md', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-mono font-medium rounded-md border tracking-tight',
        size === 'sm' && 'px-2 py-0.5 text-[11px]',
        size === 'md' && 'px-2.5 py-1 text-xs',
        variant === 'prime' && 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        variant === 'nearprime' && 'bg-sky-500/10 text-sky-400 border-sky-500/30',
        variant === 'moderate' && 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        variant === 'subprime' && 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        variant === 'neutral' && 'bg-zinc-800/60 text-zinc-300 border-zinc-700/60',
        variant === 'success' && 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80',
        variant === 'warning' && 'bg-amber-950/60 text-amber-300 border-amber-800/80',
        variant === 'danger' && 'bg-rose-950/60 text-rose-300 border-rose-800/80',
        className
      )}
    >
      {children}
    </span>
  );
}
