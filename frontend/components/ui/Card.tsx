import React from 'react';
import clsx from 'clsx';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'subtle' | 'highlight';
}

export function Card({ children, className, variant = 'default', ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border transition-all duration-150',
        variant === 'default' && 'bg-zinc-900/70 border-zinc-800 backdrop-blur-md',
        variant === 'subtle' && 'bg-zinc-950/60 border-zinc-800/80',
        variant === 'highlight' && 'bg-zinc-900 border-zinc-700 shadow-fintech',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'px-4 sm:px-5 py-4 border-b border-zinc-800/80 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('p-4 sm:p-5', className)} {...props}>
      {children}
    </div>
  );
}
