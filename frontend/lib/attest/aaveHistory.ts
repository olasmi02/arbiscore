import 'server-only';
import { createPublicClient, http, parseAbiItem, type Address, type Log } from 'viem';
import { arbitrum } from 'viem/chains';
import { LOAN_LIQUIDATED, LOAN_REPAID, MAX_HISTORY } from '@/lib/scoring/model';

/**
 * Reads a wallet's Aave V3 history on Arbitrum One and converts closed loans into ArbiScore loan
 * specs for a CreditImporter attestation.
 *
 * Conservative by design:
 * - positions count once closed (repaid) or as soon as they are liquidated; open Aave debt has no
 *   due date and is not treated as delinquent; every liquidation is recorded;
 * - repaid positions held < 14 days are dropped, matching the model's seasoning rule, so quick
 *   borrow/repay loops on Aave can't be imported as credit either;
 * - specs are anchored on the real close time (borrowedDaysAgo = daysSinceClose + 30), so the
 *   model's recency decay uses the true date the outcome happened.
 */

const POOL: Address = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const AAVE_ORACLE: Address = '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7';
const POOL_DEPLOY_BLOCK = 7_742_429n;
const DAY = 86_400;
const MIN_HELD_DAYS = 14;
const TERM_DAYS = 30;

const BORROW = parseAbiItem(
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)'
);
const REPAY = parseAbiItem(
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)'
);
const LIQUIDATION = parseAbiItem(
  'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
);
const PRICE_ABI = [parseAbiItem('function getAssetPrice(address) view returns (uint256)')] as const;
const DECIMALS_ABI = [parseAbiItem('function decimals() view returns (uint8)')] as const;

export interface AttestedHistory {
  ageDays: number;
  txCount: number;
  volumeUsd: bigint;
  amountsUsd: bigint[];
  borrowedDaysAgo: number[];
  statuses: number[];
  daysLate: number[];
  summary: { borrows: number; repaid: number; liquidated: number; skippedShort: number; open: number };
}

interface Position {
  debt: bigint; // outstanding principal (reserve units)
  peak: bigint; // largest principal during the position
  openTs: number;
  liquidated: boolean;
}

export async function readAaveHistory(wallet: Address, nowSec: number): Promise<AttestedHistory> {
  const client = createPublicClient({
    chain: arbitrum,
    transport: http(process.env.ARBITRUM_ONE_RPC, { retryCount: 5, retryDelay: 400 }),
  });
  const latest = await client.getBlockNumber();

  // Public RPCs may time out on full-history queries; bisect the block range until they succeed.
  async function logs<T>(query: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, depth = 0): Promise<T[]> {
    try {
      return await query(from, to);
    } catch (e) {
      if (depth >= 8 || to - from < 1_000_000n) throw e;
      const mid = from + (to - from) / 2n;
      return [...(await logs(query, from, mid, depth + 1)), ...(await logs(query, mid + 1n, to, depth + 1))];
    }
  }
  const borrows = await logs(
    (fromBlock, toBlock) => client.getLogs({ address: POOL, event: BORROW, args: { onBehalfOf: wallet }, fromBlock, toBlock }),
    POOL_DEPLOY_BLOCK, latest
  );
  const repays = await logs(
    (fromBlock, toBlock) => client.getLogs({ address: POOL, event: REPAY, args: { user: wallet }, fromBlock, toBlock }),
    POOL_DEPLOY_BLOCK, latest
  );
  const liquidations = await logs(
    (fromBlock, toBlock) => client.getLogs({ address: POOL, event: LIQUIDATION, args: { user: wallet }, fromBlock, toBlock }),
    POOL_DEPLOY_BLOCK, latest
  );

  type Ev = { kind: 'borrow' | 'repay' | 'liq'; reserve: Address; amount: bigint; log: Log };
  const events: Ev[] = [
    ...borrows.map((l) => ({ kind: 'borrow' as const, reserve: l.args.reserve!, amount: l.args.amount!, log: l })),
    ...repays.map((l) => ({ kind: 'repay' as const, reserve: l.args.reserve!, amount: l.args.amount!, log: l })),
    ...liquidations.map((l) => ({ kind: 'liq' as const, reserve: l.args.debtAsset!, amount: l.args.debtToCover!, log: l })),
  ].sort((a, b) => Number(a.log.blockNumber! - b.log.blockNumber!) || a.log.logIndex! - b.log.logIndex!);

  const empty: AttestedHistory = {
    ageDays: 0, txCount: 0, volumeUsd: 0n, amountsUsd: [], borrowedDaysAgo: [], statuses: [], daysLate: [],
    summary: { borrows: 0, repaid: 0, liquidated: 0, skippedShort: 0, open: 0 },
  };
  if (events.length === 0) return empty;

  // Block timestamps and reserve pricing (current Aave oracle price, USD with 8 decimals)
  const blocks = [...new Set(events.map((e) => e.log.blockNumber!))];
  const blockTs = new Map<bigint, number>();
  // A few requests at a time: public RPCs rate-limit bursts from active wallets
  for (let i = 0; i < blocks.length; i += 8) {
    await Promise.all(
      blocks.slice(i, i + 8).map(async (b) => blockTs.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp)))
    );
  }
  const reserves = [...new Set(events.map((e) => e.reserve))];
  const pricing = new Map<Address, { price: bigint; decimals: number }>();
  await Promise.all(
    reserves.map(async (r) => {
      const [price, decimals] = await Promise.all([
        client.readContract({ address: AAVE_ORACLE, abi: PRICE_ABI, functionName: 'getAssetPrice', args: [r] }),
        client.readContract({ address: r, abi: DECIMALS_ABI, functionName: 'decimals' }),
      ]);
      pricing.set(r, { price, decimals });
    })
  );
  const toUsd = (reserve: Address, amount: bigint) => {
    const p = pricing.get(reserve)!;
    return (amount * p.price) / 10n ** BigInt(p.decimals) / 100_000_000n;
  };

  // Aave debt is a running position per reserve, and repayments include accrued interest, so we
  // track positions rather than matching individual borrows (FIFO matching let interest spill into
  // later loans and silently dropped liquidations). A position opens on the first borrow and closes
  // once its principal is (nearly) paid down; any liquidation marks it liquidated and is always kept.
  const positions = new Map<Address, Position>();
  const closed: { amountUsd: bigint; openTs: number; closeTs: number; status: number }[] = [];
  let volumeUsd = 0n;
  let skippedShort = 0;
  const close = (reserve: Address, pos: Position, ts: number) => {
    positions.delete(reserve);
    if (!pos.liquidated && (ts - pos.openTs) / DAY < MIN_HELD_DAYS) {
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
    const ts = blockTs.get(e.log.blockNumber!)!;
    let pos = positions.get(e.reserve);
    if (e.kind === 'borrow') {
      if (!pos) {
        pos = { debt: 0n, peak: 0n, openTs: ts, liquidated: false };
        positions.set(e.reserve, pos);
      }
      pos.debt += e.amount;
      if (pos.debt > pos.peak) pos.peak = pos.debt;
      volumeUsd += toUsd(e.reserve, e.amount);
      continue;
    }
    if (!pos) {
      // Nothing open to match (e.g. debt accrued via interest only): still record liquidations
      if (e.kind === 'liq') {
        closed.push({ amountUsd: toUsd(e.reserve, e.amount), openTs: ts, closeTs: ts, status: LOAN_LIQUIDATED });
      }
      continue;
    }
    if (e.kind === 'liq') pos.liquidated = true;
    pos.debt = e.amount >= pos.debt ? 0n : pos.debt - e.amount;
    if (pos.debt * 100n <= pos.peak) close(e.reserve, pos, ts); // paid down to <= 1% of peak (interest dust)
  }
  // Positions still open: a liquidation already happened, so it counts; otherwise the loan is ongoing
  const lastTs = blockTs.get(events[events.length - 1].log.blockNumber!)!;
  let stillOpen = 0;
  for (const [reserve, pos] of positions) {
    if (pos.liquidated) {
      closed.push({ amountUsd: toUsd(reserve, pos.peak), openTs: pos.openTs, closeTs: lastTs, status: LOAN_LIQUIDATED });
    } else {
      stillOpen++;
    }
  }

  const recent = closed.sort((a, b) => a.closeTs - b.closeTs).slice(-MAX_HISTORY);
  const firstTs = blockTs.get(events[0].log.blockNumber!)!;
  return {
    ageDays: Math.floor((nowSec - firstTs) / DAY),
    txCount: events.length,
    volumeUsd,
    amountsUsd: recent.map((l) => (l.amountUsd > 0n ? l.amountUsd : 1n)),
    borrowedDaysAgo: recent.map((l) => Math.floor((nowSec - l.closeTs) / DAY) + TERM_DAYS),
    statuses: recent.map((l) => l.status),
    daysLate: recent.map(() => 0),
    summary: {
      borrows: borrows.length,
      repaid: recent.filter((l) => l.status === LOAN_REPAID).length,
      liquidated: recent.filter((l) => l.status === LOAN_LIQUIDATED).length,
      skippedShort,
      open: stillOpen,
    },
  };
}
