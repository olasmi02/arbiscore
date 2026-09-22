import React from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  leftIcon,
  rightIcon,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-lg transition-all select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]',
        // Sizes
        size === 'sm' && 'px-3 py-1.5 text-xs gap-1.5',
        size === 'md' && 'px-4 py-2 text-sm gap-2',
        size === 'lg' && 'px-5 py-2.5 text-base gap-2.5',
        // Variants (strictly fintech high contrast, zero neon)
        variant === 'primary' &&
          'bg-zinc-100 hover:bg-white text-zinc-950 font-semibold shadow-sm hover:shadow active:bg-zinc-200',
        variant === 'secondary' &&
          'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700/80',
        variant === 'outline' &&
          'bg-transparent hover:bg-zinc-800/60 text-zinc-200 border border-zinc-700 hover:border-zinc-600',
        variant === 'danger' &&
          'bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-800/80',
        variant === 'ghost' &&
          'bg-transparent hover:bg-zinc-800/50 text-zinc-300 hover:text-white',
        className
      )}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-current" />
      ) : (
        leftIcon
      )}
      <span>{children}</span>
      {!isLoading && rightIcon}
    </button>
  );
}
