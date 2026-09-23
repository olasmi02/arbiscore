import { LOAN_LIQUIDATED, LOAN_REPAID } from '../scoring/model.ts';

/**
 * Turns a wallet's Aave events into credit positions. Shared by the attestation service
 * (lib/attest/aaveHistory.ts) and the weight-fitting research pipeline, so the training data is
 * built exactly the way real imports are.
 *
 * Aave debt is a running position per reserve, and repayments include accrued interest, so we track
 * positions rather than matching individual borrows (borrow-by-borrow matching let interest spill into
 * later loans and silently dropped liquidations). A position opens on the first borrow and closes once
 * its principal is paid down to <= 1% of its peak; any liquidation marks it liquidated and is always kept.
 */

export interface AaveEvent {
  kind: 'borrow' | 'repay' | 'liq';
  reserve: string;
  amount: bigint; // reserve units (borrow/repay amount, or debtToCover for liquidations)
  ts: number; // unix seconds
}

export interface ClosedPosition {
  amountUsd: bigint;
  openTs: number;
  closeTs: number;
  status: number; // LOAN_REPAID | LOAN_LIQUIDATED
}

export interface OpenPosition {
  amountUsd: bigint; // outstanding principal
  openTs: number;
}

export interface PositionSummary {
  closed: ClosedPosition[];
  open: OpenPosition[]; // never liquidated, still outstanding
  volumeUsd: bigint;
  skippedShort: number;
  borrows: number;
}

const DAY = 86_400;

interface Position {
  debt: bigint;
  peak: bigint;
  openTs: number;
  liquidated: boolean;
}

/** Events must be sorted chronologically. `minHeldDays`: repaid positions held less are dropped. */
export function buildPositions(
  events: AaveEvent[],
  toUsd: (reserve: string, amount: bigint) => bigint,
  minHeldDays: number
): PositionSummary {
  const positions = new Map<string, Position>();
  const closed: ClosedPosition[] = [];
  let volumeUsd = 0n;
  let skippedShort = 0;
  let borrows = 0;

  const close = (reserve: string, pos: Position, ts: number) => {
    positions.delete(reserve);
    if (!pos.liquidated && (ts - pos.openTs) / DAY < minHeldDays) {
      skippedShort++;
      return;
    }
    closed.push({
      amountUsd: toUsd(reserve, pos.peak),
      openTs: pos.openTs,
      closeTs: ts,
      status: pos.liquidated ? LOAN_LIQUIDATED : LOAN_REPAID,
    });
  };

  for (const e of events) {
    let pos = positions.get(e.reserve);
    if (e.kind === 'borrow') {
      borrows++;
      if (!pos) {
        pos = { debt: 0n, peak: 0n, openTs: e.ts, liquidated: false };
        positions.set(e.reserve, pos);
      }
      pos.debt += e.amount;
      if (pos.debt > pos.peak) pos.peak = pos.debt;
      volumeUsd += toUsd(e.reserve, e.amount);
      continue;
    }
    if (!pos) {
      // Nothing open to match (e.g. debt that is only accrued interest): still record liquidations
      if (e.kind === 'liq') {
        closed.push({ amountUsd: toUsd(e.reserve, e.amount), openTs: e.ts, closeTs: e.ts, status: LOAN_LIQUIDATED });
      }
      continue;
    }
    if (e.kind === 'liq') pos.liquidated = true;
    pos.debt = e.amount >= pos.debt ? 0n : pos.debt - e.amount;
    if (pos.debt * 100n <= pos.peak) close(e.reserve, pos, e.ts);
  }

  // Positions still open: a liquidation already happened, so it counts; otherwise the loan is ongoing
  const lastTs = events.length ? events[events.length - 1].ts : 0;
  const open: OpenPosition[] = [];
  for (const [reserve, pos] of positions) {
    if (pos.liquidated) {
      closed.push({ amountUsd: toUsd(reserve, pos.peak), openTs: pos.openTs, closeTs: lastTs, status: LOAN_LIQUIDATED });
    } else {
      open.push({ amountUsd: toUsd(reserve, pos.debt), openTs: pos.openTs });
    }
  }
  closed.sort((a, b) => a.closeTs - b.closeTs);
  return { closed, open, volumeUsd, skippedShort, borrows };
}
