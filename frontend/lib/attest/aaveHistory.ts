import 'server-only';
import { createPublicClient, http, parseAbiItem, type Address, type Log } from 'viem';
import { unstable_cache } from 'next/cache';
import { arbitrum } from 'viem/chains';
import { LOAN_LIQUIDATED, LOAN_REPAID, MAX_HISTORY } from '@/lib/scoring/model';
import { buildPositions } from '@/lib/attest/positions';

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


/** A wallet's raw Aave activity: JSON-safe, so it can live in Next's data cache. */
interface AaveActivity {
  events: { kind: 'borrow' | 'repay' | 'liq'; reserve: Address; amount: string; ts: number }[];
  pricing: Record<string, { price: string; decimals: number }>;
  borrows: number;
}

async function fetchAaveActivity(wallet: Address): Promise<AaveActivity> {
  const client = createPublicClient({
    chain: arbitrum,
    // Needs full-range eth_getLogs: the default public endpoint (arb1.arbitrum.io) allows it, but
    // many free tiers (e.g. Alchemy: 10 blocks) don't. Concurrent calls are sent as JSON-RPC batches
    // (fewer HTTP requests against public rate limits); retries back off exponentially.
    transport: http(process.env.ARBITRUM_ONE_RPC, { batch: { batchSize: 25 }, retryCount: 4, retryDelay: 750 }),
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
  // Issued together so the transport sends all three in one HTTP request
  const [borrows, repays, liquidations] = await Promise.all([
    logs(
      (fromBlock, toBlock) => client.getLogs({ address: POOL, event: BORROW, args: { onBehalfOf: wallet }, fromBlock, toBlock }),
      POOL_DEPLOY_BLOCK, latest
    ),
    logs(
      (fromBlock, toBlock) => client.getLogs({ address: POOL, event: REPAY, args: { user: wallet }, fromBlock, toBlock }),
      POOL_DEPLOY_BLOCK, latest
    ),
    logs(
      (fromBlock, toBlock) => client.getLogs({ address: POOL, event: LIQUIDATION, args: { user: wallet }, fromBlock, toBlock }),
      POOL_DEPLOY_BLOCK, latest
    ),
  ]);

  type Ev = { kind: 'borrow' | 'repay' | 'liq'; reserve: Address; amount: bigint; log: Log };
  const events: Ev[] = [
    ...borrows.map((l) => ({ kind: 'borrow' as const, reserve: l.args.reserve!, amount: l.args.amount!, log: l })),
    ...repays.map((l) => ({ kind: 'repay' as const, reserve: l.args.reserve!, amount: l.args.amount!, log: l })),
    ...liquidations.map((l) => ({ kind: 'liq' as const, reserve: l.args.debtAsset!, amount: l.args.debtToCover!, log: l })),
  ].sort((a, b) => Number(a.log.blockNumber! - b.log.blockNumber!) || a.log.logIndex! - b.log.logIndex!);
  if (events.length === 0) return { events: [], pricing: {}, borrows: 0 };

  // Block timestamps (a log's own `blockTimestamp` is used when the node fills it in; arb1 returns 0)
  // and reserve pricing (current Aave oracle price, USD with 8 decimals), fetched concurrently so the
  // transport batches them.
  const blockTs = new Map<bigint, number>();
  for (const e of events) {
    const ts = Number((e.log as { blockTimestamp?: bigint | string | number }).blockTimestamp ?? 0);
    if (ts > 0) blockTs.set(e.log.blockNumber!, ts);
  }
  const missing = [...new Set(events.map((e) => e.log.blockNumber!))].filter((b) => !blockTs.has(b));
  const reserves = [...new Set(events.map((e) => e.reserve))];
  const pricing: AaveActivity['pricing'] = {};
  await Promise.all([
    ...missing.map(async (b) => blockTs.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))),
    ...reserves.map(async (r) => {
      const [price, decimals] = await Promise.all([
        client.readContract({ address: AAVE_ORACLE, abi: PRICE_ABI, functionName: 'getAssetPrice', args: [r] }),
        client.readContract({ address: r, abi: DECIMALS_ABI, functionName: 'decimals' }),
      ]);
      pricing[r] = { price: price.toString(), decimals };
    }),
  ]);

  return {
    events: events.map((e) => ({ kind: e.kind, reserve: e.reserve, amount: e.amount.toString(), ts: blockTs.get(e.log.blockNumber!)! })),
    pricing,
    borrows: borrows.length,
  };
}

/**
 * Each wallet's activity is cached for an hour in Next's data cache (shared across serverless
 * invocations on Vercel), so repeat imports, such as the demo borrowers, skip the public RPC.
 * Attestations stay conservative: at most an hour of new Aave activity is missing.
 */
const cachedAaveActivity = unstable_cache(fetchAaveActivity, ['aave-activity-v1'], { revalidate: 3600 });

export async function readAaveHistory(wallet: Address, nowSec: number): Promise<AttestedHistory> {
  const activity = await cachedAaveActivity(wallet);
  const empty: AttestedHistory = {
    ageDays: 0, txCount: 0, volumeUsd: 0n, amountsUsd: [], borrowedDaysAgo: [], statuses: [], daysLate: [],
    summary: { borrows: 0, repaid: 0, liquidated: 0, skippedShort: 0, open: 0 },
  };
  if (activity.events.length === 0) return empty;

  const toUsd = (reserve: string, amount: bigint) => {
    const p = activity.pricing[reserve];
    return (amount * BigInt(p.price)) / 10n ** BigInt(p.decimals) / 100_000_000n;
  };
  const summary = buildPositions(
    activity.events.map((e) => ({ kind: e.kind, reserve: e.reserve, amount: BigInt(e.amount), ts: e.ts })),
    toUsd,
    MIN_HELD_DAYS
  );
  const { closed, volumeUsd, skippedShort } = summary;
  const stillOpen = summary.open.length;

  const recent = closed.slice(-MAX_HISTORY);
  const firstTs = activity.events[0].ts;
  return {
    ageDays: Math.floor((nowSec - firstTs) / DAY),
    txCount: activity.events.length,
    volumeUsd,
    amountsUsd: recent.map((l) => (l.amountUsd > 0n ? l.amountUsd : 1n)),
    borrowedDaysAgo: recent.map((l) => Math.floor((nowSec - l.closeTs) / DAY) + TERM_DAYS),
    statuses: recent.map((l) => l.status),
    daysLate: recent.map(() => 0),
    summary: {
      borrows: activity.borrows,
      repaid: recent.filter((l) => l.status === LOAN_REPAID).length,
      liquidated: recent.filter((l) => l.status === LOAN_LIQUIDATED).length,
      skippedShort,
      open: stillOpen,
    },
  };
}
