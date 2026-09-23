import React from 'react';
import { FactorBreakdown as FactorBreakdownType } from '@/lib/types';
import { CheckCircle, Clock, Activity, AlertOctagon } from 'lucide-react';
import clsx from 'clsx';

interface FactorBreakdownProps {
  factors: FactorBreakdownType;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function Points({ value }: { value: number }) {
  return (
    <span
      className={clsx(
        'text-xs font-mono font-bold tabular-nums whitespace-nowrap',
        value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : 'text-zinc-500'
      )}
    >
      {value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0'} pts
    </span>
  );
}

interface FactorCardProps {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  model: string;
  points: number;
  detailLabel: string;
  detail: React.ReactNode;
}

function FactorCard({ icon, iconClass, title, model, points, detailLabel, detail }: FactorCardProps) {
  return (
    <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/90 flex flex-col justify-between hover:border-zinc-700/80 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className={clsx('p-1.5 rounded-lg border', iconClass)}>{icon}</div>
          <div>
            <div className="text-xs font-semibold text-zinc-200">{title}</div>
            <div className="text-[10px] font-mono text-zinc-500">{model}</div>
          </div>
        </div>
        <Points value={points} />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-zinc-800/60 pt-2.5">
        <span className="text-xs text-zinc-400">{detailLabel}</span>
        <span className="text-xs font-mono font-bold text-white tabular-nums text-right">{detail}</span>
      </div>
    </div>
  );
}

/**
 * Leave-one-out attribution: each card shows how many score points its features add or remove
 * versus a brand-new wallet, as computed by the same model the Stylus engine runs.
 */
export function FactorBreakdown({ factors }: FactorBreakdownProps) {
  const { impacts, features } = factors;
  const closed = factors.repaidOnTime + factors.repaidLate;
  const hasDefaults = factors.liquidations + factors.delinquent > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
      <FactorCard
        icon={<CheckCircle className="w-4 h-4" />}
        iconClass="bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        title="Repayment Track Record"
        model="Recency- & size-weighted quality + depth"
        points={impacts.quality + impacts.depth}
        detailLabel={`Quality ${pct(features.quality)}`}
        detail={closed === 0 ? 'No repayments yet' : `${factors.repaidOnTime} on-time • ${factors.repaidLate} late`}
      />
      <FactorCard
        icon={<Clock className="w-4 h-4" />}
        iconClass="bg-sky-500/10 text-sky-400 border-sky-500/20"
        title="Longevity & Wallet Age"
        model="Saturating, half-weight at 180 days"
        points={impacts.age}
        detailLabel="Account History"
        detail={`${factors.ageDays} Days Active`}
      />
      <FactorCard
        icon={<Activity className="w-4 h-4" />}
        iconClass="bg-amber-500/10 text-amber-400 border-amber-500/20"
        title="Activity & Volume"
        model="Tx count + USD volume, saturating"
        points={impacts.activity + impacts.volume}
        detailLabel="Cumulative Txs"
        detail={`${factors.txCount} txs • $${factors.volumeUSD.toLocaleString()} vol`}
      />
      <FactorCard
        icon={<AlertOctagon className="w-4 h-4" />}
        iconClass={
          hasDefaults
            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60'
        }
        title="Defaults & Open Exposure"
        model="Decaying liquidations + utilization"
        points={impacts.liquidation + impacts.utilization}
        detailLabel={`Utilization ${pct(features.utilization)}`}
        detail={
          <span className={hasDefaults ? 'text-rose-400' : 'text-emerald-400'}>
            {hasDefaults
              ? `${factors.liquidations} liquidated • ${factors.delinquent} overdue`
              : 'Clean record'}
          </span>
        }
      />
      {factors.delinquent > 0 && (
        <div role="note" className="sm:col-span-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
          Score capped at 599 (Subprime) while a loan is overdue and unpaid. Repaying it, even late, lifts the cap.
        </div>
      )}
    </div>
  );
}
