/**
 * Generates cross-implementation test vectors from the TypeScript reference model.
 * The Rust (Stylus) and Solidity engines must reproduce every score exactly.
 *
 *   node --experimental-strip-types contracts/test_vectors/gen_score_vectors.ts
 *
 * Line format: expected first_ts txs volume now|amount,borrow,due,close,status;...
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeScore,
  specToEntry,
  LOAN_OPEN,
  LOAN_REPAID,
  LOAN_LIQUIDATED,
  type LoanEntry,
  type ModelInput,
} from '../../frontend/lib/scoring/model.ts';
import { PERSONA_PROFILES } from '../../frontend/lib/scoring/personaProfiles.ts';

const DAY = 86_400n;
const NOW = 1_790_000_000n;

// Deterministic PRNG (mulberry32)
let seed = 0x5eed1234;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const cases: ModelInput[] = [];

// Personas (and Charlie after repaying his open loan)
for (const p of Object.values(PERSONA_PROFILES)) {
  cases.push({
    firstActivityTs: NOW - BigInt(p.ageDays) * DAY,
    totalTxs: BigInt(p.totalTransactions),
    volumeUsd: BigInt(p.totalVolumeUSD),
    loans: p.loans.map((l) => specToEntry(l, NOW)),
    now: NOW,
  });
}

// Edge cases
const edge = (first: bigint, txs: bigint, vol: bigint, loans: LoanEntry[], now = NOW) =>
  cases.push({ firstActivityTs: first, totalTxs: txs, volumeUsd: vol, loans, now });
edge(0n, 0n, 0n, []);
edge(NOW, 0n, 0n, []);
edge(NOW + 1000n, 5n, 10n, []);
edge(1n, 4_294_967_295n, (1n << 64n) - 1n, []);
edge(1n, 4_294_967_295n, (1n << 64n) - 1n, [{ amountUsd: (1n << 64n) - 1n, borrowTs: 1n, dueTs: 2n, closeTs: 3n, status: LOAN_REPAID }]);
edge(NOW - 400n * DAY, 10n, 1000n, [{ amountUsd: 0n, borrowTs: NOW - 50n * DAY, dueTs: NOW - 20n * DAY, closeTs: NOW - 20n * DAY, status: LOAN_REPAID }]);
edge(NOW - 400n * DAY, 10n, 1000n, [{ amountUsd: 5000n, borrowTs: NOW, dueTs: NOW + 30n * DAY, closeTs: NOW + 99n, status: LOAN_REPAID }]);
edge(NOW - 400n * DAY, 10n, 1000n, [{ amountUsd: 5000n, borrowTs: NOW - 90n * DAY, dueTs: NOW - 60n * DAY, closeTs: 0n, status: LOAN_OPEN }]);

// Randomized histories, including > MAX_HISTORY loans and very old / very late loans
for (let c = 0; c < 400; c++) {
  const age = ri(0, 2000);
  const nLoans = c % 50 === 0 ? ri(65, 90) : ri(0, 20);
  const loans: LoanEntry[] = [];
  for (let i = 0; i < nLoans; i++) {
    const r = rand();
    const status = r < 0.65 ? LOAN_REPAID : r < 0.8 ? LOAN_LIQUIDATED : LOAN_OPEN;
    const late = rand() < 0.3 ? ri(1, 120) : 0;
    loans.push(specToEntry({ amountUsd: ri(0, 60_000), borrowedDaysAgo: ri(0, age + 30), status, daysLate: late }, NOW));
  }
  cases.push({
    firstActivityTs: NOW - BigInt(age) * DAY,
    totalTxs: BigInt(ri(0, 5000)),
    volumeUsd: BigInt(ri(0, 2_000_000)),
    loans,
    now: NOW,
  });
}

const lines = cases.map((c) => {
  const loans = c.loans.map((l) => `${l.amountUsd},${l.borrowTs},${l.dueTs},${l.closeTs},${l.status}`).join(';');
  return `${computeScore(c)} ${c.firstActivityTs} ${c.totalTxs} ${c.volumeUsd} ${c.now}|${loans}`;
});

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'score_vectors.txt');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${lines.length} vectors to ${out}`);
