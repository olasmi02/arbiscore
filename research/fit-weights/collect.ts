/**
 * Builds the training set for fitting ArbiScore's model weights on real Aave V3 (Arbitrum One) data.
 *
 *   node --experimental-strip-types research/fit-weights/collect.ts
 *
 * Design (no look-ahead):
 * - Cutoff T = now - 180 days. Features use ONLY a wallet's Aave history before T, built with the
 *   same position logic and model code as live imports (frontend/lib/attest/positions.ts,
 *   frontend/lib/scoring/model.ts).
 * - Label = 1 if the wallet was liquidated on Aave in (T, now], else 0.
 * - Population: wallets with Aave history before T. Positives are all wallets liquidated in the
 *   window (sampled); negatives come from borrowers sampled across Aave's history.
 * Output: dataset.csv and population_stats.json (resumable; progress cached in the gitignored cache.json).
 *
 * CUTOFF_OFFSET_DAYS=N moves the cutoff N days earlier (label window (T, T+180d] moves with it) and
 * writes dataset_cutoff-Nd.csv etc. instead: an out-of-time check for the fitted weights.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  http,
  parseAbiItem,
  getAddress,
  type Address,
} from '../../frontend/node_modules/viem/_esm/index.js';
import { arbitrum } from '../../frontend/node_modules/viem/_esm/chains/index.js';
import { buildPositions, type AaveEvent } from '../../frontend/lib/attest/positions.ts';
import {
  computeFeatures,
  probabilityFromFeatures,
  specToEntry,
  LOAN_OPEN,
  MAX_HISTORY,
  S,
} from '../../frontend/lib/scoring/model.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POOL: Address = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const AAVE_ORACLE: Address = '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7';
const DEPLOY_BLOCK = 7_742_429n;
const DAY = 86_400;
const WINDOW_DAYS = 180;
const OFFSET_DAYS = Number(process.env.CUTOFF_OFFSET_DAYS ?? 0);
const TAG = OFFSET_DAYS ? `_cutoff-${OFFSET_DAYS}d` : '';
const MAX_POSITIVES = Number(process.env.MAX_POSITIVES ?? 700);
const MAX_NEGATIVES = Number(process.env.MAX_NEGATIVES ?? 1100);
const CONCURRENCY = 4;

const BORROW = parseAbiItem('event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)');
const REPAY = parseAbiItem('event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)');
const LIQ = parseAbiItem('event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)');

const client = createPublicClient({ chain: arbitrum, transport: http(process.env.ARBITRUM_ONE_RPC, { retryCount: 6, retryDelay: 500 }) });

// Deterministic PRNG so the sample is reproducible
let seed = 20260923;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function logs<T>(q: (f: bigint, t: bigint) => Promise<T[]>, from: bigint, to: bigint, depth = 0): Promise<T[]> {
  try {
    return await q(from, to);
  } catch (e) {
    if (depth >= 10 || to - from < 200_000n) throw e;
    const mid = from + (to - from) / 2n;
    return [...(await logs(q, from, mid, depth + 1)), ...(await logs(q, mid + 1n, to, depth + 1))];
  }
}

async function main() {
  const cacheFile = path.join(HERE, `cache${TAG}.json`);
  const baseCache = path.join(HERE, 'cache.json');
  let cache: any = { rows: {} };
  if (fs.existsSync(cacheFile)) cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  else if (TAG && fs.existsSync(baseCache)) {
    // Reuse the block->timestamp anchors and reserve prices from the main run
    const b = JSON.parse(fs.readFileSync(baseCache, 'utf8'));
    cache = { rows: {}, anchors: b.anchors, nowTs: b.nowTs, latest: b.latest, prices: b.prices };
  }
  const save = () => fs.writeFileSync(cacheFile, JSON.stringify(cache));

  // 1. Block -> timestamp by interpolation between anchors (day-level accuracy is all we need)
  const latest = await client.getBlockNumber();
  if (!cache.anchors) {
    const blocks: bigint[] = [];
    for (let b = DEPLOY_BLOCK; b < latest; b += 2_000_000n) blocks.push(b);
    blocks.push(latest);
    const anchors: [number, number][] = [];
    for (let i = 0; i < blocks.length; i += 8) {
      const got = await Promise.all(blocks.slice(i, i + 8).map((b) => client.getBlock({ blockNumber: b })));
      for (const b of got) anchors.push([Number(b.number), Number(b.timestamp)]);
    }
    cache.anchors = anchors.sort((a, b) => a[0] - b[0]);
    cache.nowTs = cache.anchors[cache.anchors.length - 1][1];
    cache.latest = Number(latest);
    save();
  }
  const A: [number, number][] = cache.anchors;
  const tsOf = (block: number) => {
    let lo = 0, hi = A.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m][0] <= block) lo = m; else hi = m; }
    const [b0, t0] = A[lo], [b1, t1] = A[hi];
    return b1 === b0 ? t0 : Math.round(t0 + ((block - b0) * (t1 - t0)) / (b1 - b0));
  };
  const blockOf = (ts: number) => { let lo = 0; while (lo < A.length - 1 && A[lo + 1][1] <= ts) lo++; const [b0, t0] = A[lo], [b1, t1] = A[Math.min(lo + 1, A.length - 1)]; return BigInt(Math.round(b0 + ((ts - t0) * (b1 - b0)) / Math.max(1, t1 - t0))); };
  const nowTs: number = cache.nowTs;
  const T = nowTs - (WINDOW_DAYS + OFFSET_DAYS) * DAY;
  const tBlock = blockOf(T);
  const windowEndBlock = OFFSET_DAYS ? blockOf(T + WINDOW_DAYS * DAY) : BigInt(cache.latest);
  console.log(`cutoff T=${new Date(T * 1000).toISOString()} (block ${tBlock}), window ${WINDOW_DAYS}d to block ${windowEndBlock}`);

  // 2. Positives: wallets liquidated in (T, T + 180d]
  if (!cache.liquidated) {
    const set = new Set<string>();
    for (let b = tBlock; b <= windowEndBlock; b += 2_000_000n) {
      const to = b + 1_999_999n > windowEndBlock ? windowEndBlock : b + 1_999_999n;
      const l = await logs((f, t) => client.getLogs({ address: POOL, event: LIQ, fromBlock: f, toBlock: t }), b, to);
      for (const x of l) set.add(getAddress(x.args.user!));
    }
    cache.liquidated = [...set];
    save();
  }
  const L = new Set<string>(cache.liquidated);
  console.log(`liquidated in window: ${L.size}`);

  // 3. Population: borrowers sampled from random windows before T
  if (!cache.population) {
    const set = new Set<string>();
    for (let k = 0; k < 50; k++) {
      const start = DEPLOY_BLOCK + BigInt(Math.floor(rand() * Number(tBlock - DEPLOY_BLOCK - 300_000n)));
      const l = await logs((f, t) => client.getLogs({ address: POOL, event: BORROW, fromBlock: f, toBlock: t }), start, start + 300_000n);
      for (const x of l) set.add(getAddress(x.args.onBehalfOf!));
    }
    cache.population = [...set];
    save();
  }
  const positives = shuffle([...L]).slice(0, MAX_POSITIVES);
  const negatives = shuffle((cache.population as string[]).filter((w) => !L.has(w))).slice(0, MAX_NEGATIVES);
  const todo = [...positives, ...negatives].filter((w) => !(w in cache.rows));
  console.log(`sample: ${positives.length} liquidated + ${negatives.length} others; ${todo.length} left to index`);

  // 4. Per-wallet features as of T
  const prices = new Map<string, { price: bigint; decimals: number }>(Object.entries(cache.prices ?? {}).map(([k, v]: any) => [k, { price: BigInt(v.price), decimals: v.decimals }]));
  const priceOf = async (r: string) => {
    if (!prices.has(r)) {
      const [price, decimals] = await Promise.all([
        client.readContract({ address: AAVE_ORACLE, abi: [parseAbiItem('function getAssetPrice(address) view returns (uint256)')], functionName: 'getAssetPrice', args: [r as Address] }),
        client.readContract({ address: r as Address, abi: [parseAbiItem('function decimals() view returns (uint8)')], functionName: 'decimals' }),
      ]);
      prices.set(r, { price, decimals });
      cache.prices = Object.fromEntries([...prices].map(([k, v]) => [k, { price: v.price.toString(), decimals: v.decimals }]));
    }
    return prices.get(r)!;
  };

  let done = 0;
  async function processWallet(w: string) {
    const [b, r, l] = await Promise.all([
      logs((f, t) => client.getLogs({ address: POOL, event: BORROW, args: { onBehalfOf: w as Address }, fromBlock: f, toBlock: t }), DEPLOY_BLOCK, tBlock),
      logs((f, t) => client.getLogs({ address: POOL, event: REPAY, args: { user: w as Address }, fromBlock: f, toBlock: t }), DEPLOY_BLOCK, tBlock),
      logs((f, t) => client.getLogs({ address: POOL, event: LIQ, args: { user: w as Address }, fromBlock: f, toBlock: t }), DEPLOY_BLOCK, tBlock),
    ]);
    const ev: (AaveEvent & { idx: number; blk: number })[] = [
      ...b.map((x) => ({ kind: 'borrow' as const, reserve: x.args.reserve!, amount: x.args.amount!, blk: Number(x.blockNumber), idx: x.logIndex!, ts: 0 })),
      ...r.map((x) => ({ kind: 'repay' as const, reserve: x.args.reserve!, amount: x.args.amount!, blk: Number(x.blockNumber), idx: x.logIndex!, ts: 0 })),
      ...l.map((x) => ({ kind: 'liq' as const, reserve: x.args.debtAsset!, amount: x.args.debtToCover!, blk: Number(x.blockNumber), idx: x.logIndex!, ts: 0 })),
    ].sort((a, c) => a.blk - c.blk || a.idx - c.idx);
    if (ev.length === 0) { cache.rows[w] = null; return; } // no Aave history before T
    for (const e of ev) { e.ts = tsOf(e.blk); await priceOf(e.reserve); }
    const toUsd = (res: string, amt: bigint) => { const p = prices.get(res)!; return (amt * p.price) / 10n ** BigInt(p.decimals) / 100_000_000n; };
    const pos = buildPositions(ev, toUsd, 14);
    const specs = [
      ...pos.closed.slice(-MAX_HISTORY).map((c) => ({ amountUsd: Number(c.amountUsd > 0n ? c.amountUsd : 1n), borrowedDaysAgo: Math.floor((T - c.closeTs) / DAY) + 30, status: c.status, daysLate: 0 })),
      ...pos.open.map((o) => ({ amountUsd: Number(o.amountUsd > 0n ? o.amountUsd : 1n), borrowedDaysAgo: 0, status: LOAN_OPEN, daysLate: 0 })),
    ];
    const now = BigInt(T);
    const input = {
      firstActivityTs: BigInt(ev[0].ts),
      totalTxs: BigInt(ev.length),
      volumeUsd: pos.volumeUsd,
      loans: specs.map((s) => specToEntry(s, now)),
      now,
    };
    const f = computeFeatures(input);
    const toF = (x: bigint) => Number(x) / Number(S);
    cache.rows[w] = {
      label: L.has(w) ? 1 : 0,
      quality: toF(f.quality), depth: toF(f.depth), liquidation: toF(f.liquidation), age: toF(f.age),
      activity: toF(f.activity), volume: toF(f.volume), utilization: toF(f.utilization),
      handP: toF(probabilityFromFeatures(f)), events: ev.length, closed: pos.closed.length, open: pos.open.length,
    };
  }

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(async (w) => {
      try { await processWallet(w); } catch (e) { console.log(`skip ${w}: ${(e as Error).message.slice(0, 60)}`); }
    }));
    done += CONCURRENCY;
    if (done % 40 === 0) { save(); console.log(`${Math.min(done, todo.length)}/${todo.length}`); }
  }
  save();

  const rows = Object.entries(cache.rows).filter(([, v]) => v) as [string, any][];
  const cols = ['wallet', 'label', 'quality', 'depth', 'liquidation', 'age', 'activity', 'volume', 'utilization', 'handP', 'events', 'closed', 'open'];
  const csv = [cols.join(','), ...rows.map(([w, v]) => [w, ...cols.slice(1).map((c) => v[c])].join(','))].join('\n');
  fs.writeFileSync(path.join(HERE, `dataset${TAG}.csv`), csv + '\n');
  fs.writeFileSync(path.join(HERE, `population_stats${TAG}.json`), JSON.stringify({
    population_sampled: cache.population.length,
    population_liquidated_in_window: (cache.population as string[]).filter((w) => L.has(w)).length,
    liquidated_in_window: L.size,
    cutoff_ts: T,
    window_end_ts: T + WINDOW_DAYS * DAY,
    now_ts: nowTs,
  }, null, 2));
  const pos = rows.filter(([, v]) => v.label === 1).length;
  console.log(`dataset${TAG}.csv: ${rows.length} wallets with pre-cutoff history (${pos} liquidated in window, ${rows.length - pos} not)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
