/**
 * Behavioural checks for the credit model: rules a credit score must never break, tested on
 * thousands of random borrowing histories and points in time, plus measurements of known gaming
 * strategies. Uses the TypeScript model, which is bit-identical to the Rust engine and the
 * Solidity port (see score_vectors.txt), so every result here holds on-chain too.
 *
 *   node --experimental-strip-types contracts/test_vectors/model_properties.ts
 */
import {
  computeScore,
  LOAN_OPEN,
  LOAN_REPAID,
  LOAN_LIQUIDATED,
  type LoanEntry,
} from '../../frontend/lib/scoring/model.ts';

const DAY = 86_400n;
const TERM = 30n * DAY;
const NOW = 1_790_000_000n;
const TIERS = [750, 680, 600];
const tier = (s: number) => TIERS.filter((t) => s >= t).length; // 0 = Subprime .. 3 = Prime

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

/** A closed loan borrowed `ago` days before `at`, with a given outcome. */
function closed(amount: number, borrowTs: bigint, status: number, daysLate = 0, heldDays?: number): LoanEntry {
  const dueTs = borrowTs + TERM;
  const closeTs = heldDays !== undefined ? borrowTs + BigInt(heldDays) * DAY : dueTs + BigInt(daysLate) * DAY;
  return { amountUsd: BigInt(amount), borrowTs, dueTs, closeTs, status };
}
const open = (amount: number, borrowTs: bigint): LoanEntry => ({ amountUsd: BigInt(amount), borrowTs, dueTs: borrowTs + TERM, closeTs: 0n, status: LOAN_OPEN });

/** Random history of up to `n` closed loans, all finished before `before`. */
function randomHistory(before: bigint, n = int(0, 12)): LoanEntry[] {
  const out: LoanEntry[] = [];
  for (let i = 0; i < n; i++) {
    const b = before - BigInt(int(40, 700)) * DAY;
    const r = rnd();
    const status = r < 0.12 ? LOAN_LIQUIDATED : LOAN_REPAID;
    const late = status === LOAN_REPAID && rnd() < 0.2 ? int(1, 60) : 0;
    const held = status === LOAN_REPAID && late === 0 ? int(1, 30) : undefined;
    const loan = closed(pick([1, 50, 500, 2_000, 10_000, 80_000]), b, status, late, held);
    if (loan.closeTs < before) out.push(loan);
  }
  return out.sort((a, b) => Number(a.borrowTs - b.borrowTs));
}
function randomWallet(at: bigint) {
  return { firstActivityTs: at - BigInt(int(0, 900)) * DAY, totalTxs: BigInt(int(0, 300)), volumeUsd: BigInt(int(0, 200_000)) };
}
const score = (w: ReturnType<typeof randomWallet>, loans: LoanEntry[], now: bigint) => computeScore({ ...w, loans, now });

type Failure = { rule: string; detail: string };
const failures: Failure[] = [];
const counts: Record<string, number> = {};
function check(rule: string, ok: boolean, detail: () => string) {
  counts[rule] = (counts[rule] ?? 0) + 1;
  if (!ok && failures.filter((f) => f.rule === rule).length < 3) failures.push({ rule, detail: detail() });
}

const TRIALS = 3000;
for (let t = 0; t < TRIALS; t++) {
  const w = randomWallet(NOW);
  const hist = randomHistory(NOW);
  const amt = pick([1, 100, 1_000, 5_000, 25_000]);
  const b = NOW - BigInt(int(0, 25)) * DAY; // a new loan borrowed recently
  const due = b + TERM;

  // R1 Paying beats not paying: at any time after the due date, repaying (on time or late)
  //    scores at least as well as leaving the loan unpaid.
  for (const after of [1, 5, 20, 60, 200]) {
    const at = due + BigInt(after) * DAY;
    const unpaid = score(w, [...hist, open(amt, b)], at);
    const paidOnTime = score(w, [...hist, closed(amt, b, LOAN_REPAID, 0)], at);
    const paidLate = score(w, [...hist, closed(amt, b, LOAN_REPAID, Math.max(0, after - 1))], at);
    check('R1 repaying on time >= leaving it unpaid', paidOnTime >= unpaid, () => `amt ${amt}, ${after}d after due: on time ${paidOnTime} < unpaid ${unpaid}`);
    check('R1b repaying late >= leaving it unpaid', paidLate >= unpaid, () => `amt ${amt}, ${after}d after due: paid ${after - 1}d late ${paidLate} < unpaid ${unpaid}`);
  }

  // R2 Late repayment never beats on-time repayment of the same loan (same evaluation time).
  {
    const at = due + 90n * DAY;
    const onTime = score(w, [...hist, closed(amt, b, LOAN_REPAID, 0)], at);
    for (const late of [1, 7, 30, 80]) {
      const l = score(w, [...hist, closed(amt, b, LOAN_REPAID, late)], at);
      check('R2 late repayment <= on-time repayment', l <= onTime, () => `amt ${amt}: ${late}d late ${l} > on time ${onTime}`);
    }
  }

  // R3 A liquidation never beats any repayment of the same loan.
  {
    const at = due + 40n * DAY;
    const liq = score(w, [...hist, closed(amt, b, LOAN_LIQUIDATED, 10)], at);
    const late = score(w, [...hist, closed(amt, b, LOAN_REPAID, 10)], at);
    check('R3 liquidated <= repaid late', liq <= late, () => `amt ${amt}: liquidated ${liq} > repaid late ${late}`);
  }

  // R4 Adding a liquidation to any history never raises the score.
  {
    const base = score(w, hist, NOW);
    const withLiq = score(w, [...hist, closed(amt, NOW - 60n * DAY, LOAN_LIQUIDATED, 5)], NOW);
    check('R4 extra liquidation never helps', withLiq <= base, () => `amt ${amt}: ${base} -> ${withLiq}`);
  }

  // R5 Taking a new loan (not yet due) never raises the score by itself.
  {
    const base = score(w, hist, NOW);
    const withOpen = score(w, [...hist, open(amt, NOW - 5n * DAY)], NOW);
    check('R5 an open loan never raises the score', withOpen <= base, () => `amt ${amt}: ${base} -> ${withOpen}`);
  }

  // R6 Repaying a loan before its due date is never worse than keeping it open.
  for (const heldDays of [1, 7, 14, 29]) {
    const bb = NOW - BigInt(heldDays) * DAY;
    const keep = score(w, [...hist, open(amt, bb)], NOW);
    const repay = score(w, [...hist, closed(amt, bb, LOAN_REPAID, 0, heldDays)], NOW);
    check('R6 early repayment >= keeping the loan open', repay >= keep, () => `amt ${amt}, held ${heldDays}d: repaid ${repay} < open ${keep}`);
  }

  // R7 While a loan stays unpaid past its due date, the tier never improves.
  {
    const start = score(w, [...hist, open(amt, b)], due + DAY);
    for (const d of [30, 120, 365, 900]) {
      const s = score(w, [...hist, open(amt, b)], due + BigInt(d) * DAY);
      check('R7 unpaid overdue loan never improves the tier', tier(s) <= tier(start), () => `amt ${amt}: day 1 ${start} -> day ${d} ${s}`);
    }
  }

  // R8 An extra seasoned, on-time repayment never lowers the score.
  {
    const base = score(w, hist, NOW);
    const more = score(w, [...hist, closed(amt, NOW - 45n * DAY, LOAN_REPAID, 0)], NOW);
    check('R8 extra on-time repayment never hurts', more >= base, () => `amt ${amt}: ${base} -> ${more}`);
  }

  // R10 Liquidations can't be buried: pushing them out of the 64-loan window with many new
  //     repayments must not remove their effect (the 16 most recent still count).
  {
    const liqs = [closed(amt, NOW - 200n * DAY, LOAN_LIQUIDATED, 5), closed(amt, NOW - 150n * DAY, LOAN_LIQUIDATED, 5)];
    const dustTail = Array.from({ length: 64 }, (_, i) => closed(1, NOW - BigInt(100 - i) * DAY, LOAN_REPAID, 0, 14));
    const withLiqs = score(w, [...hist, ...liqs, ...dustTail], NOW);
    const withoutLiqs = score(w, [...hist, ...dustTail], NOW);
    // A buried liquidation never helps, and from $100 up it visibly hurts ($1 liquidations weigh almost nothing)
    const ok = withLiqs <= withoutLiqs && (amt < 100 || withLiqs < withoutLiqs);
    check('R10 liquidations cannot be buried under new loans', ok, () => `amt ${amt}: with buried liquidations ${withLiqs} vs clean ${withoutLiqs}`);
  }

  // R9 Score stays in [300, 850] for any history and time.
  {
    const at = NOW + BigInt(int(0, 3000)) * DAY;
    const s = score(w, [...hist, open(amt, b)], at);
    check('R9 score within 300..850', s >= 300 && s <= 850, () => `score ${s}`);
  }
}

// ---------- Gaming strategies (measurements, not pass/fail) ----------
// The vault allows at most 3 open loans per borrower per market (MAX_OPEN_LOANS), so dust farming
// runs in cycles of 3 concurrent loans held 14 days.
function capped(amount: number, cycles: number) {
  const start = NOW - BigInt(cycles * 14) * DAY;
  const loans: LoanEntry[] = [];
  for (let c = 0; c < cycles; c++) for (let i = 0; i < 3; i++) loans.push(closed(amount, start + BigInt(c * 14) * DAY, LOAN_REPAID, 0, 14));
  return computeScore({ firstActivityTs: start, totalTxs: 0n, volumeUsd: 0n, loans, now: NOW });
}
const fresh = { firstActivityTs: NOW - 20n * DAY, totalTxs: 0n, volumeUsd: 0n };
const dust = (n: number, amount: number) =>
  Array.from({ length: n }, () => closed(amount, NOW - 16n * DAY, LOAN_REPAID, 0, 14)); // n loans borrowed together, each held 14 days
const g: string[] = [];
g.push(`fresh wallet, no loans: ${score(fresh, [], NOW)}`);
for (const [n, a] of [[1, 1], [10, 1], [64, 1], [64, 10], [1, 10_000], [10, 1_000], [64, 156]] as [number, number][]) {
  const s = score(fresh, dust(n, a), NOW);
  g.push(`model only (no vault cap): ${n} concurrent loans of $${a} (held 14d, total $${n * a}): ${s} (tier ${['Subprime', 'Moderate', 'Near-Prime', 'Prime'][tier(s)]})`);
}
for (const cycles of [1, 4, 13, 26]) {
  const s1 = capped(1, cycles);
  g.push(`with the vault's 3-open-loan cap: $1 loans for ${cycles * 14} days: ${s1} (${['Subprime', 'Moderate', 'Near-Prime', 'Prime'][tier(s1)]})`);
}
// Burying bad history: two recent liquidations, then 64 dust loans push them out of the 64-loan window
const bad = [closed(5_000, NOW - 120n * DAY, LOAN_LIQUIDATED, 10), closed(4_000, NOW - 90n * DAY, LOAN_LIQUIDATED, 5)];
const w2 = { firstActivityTs: NOW - 400n * DAY, totalTxs: 50n, volumeUsd: 20_000n };
g.push(`two recent liquidations: ${score(w2, bad, NOW)}`);
g.push(`same + 62 dust loans ($1, 14d): ${score(w2, [...bad, ...dust(62, 1)], NOW)}`);
g.push(`same + 64 dust loans ($1, 14d, liquidations now outside the window but still counted): ${score(w2, [...bad, ...dust(64, 1)], NOW)}`);

console.log(`Model rules (${TRIALS} random histories each):`);
for (const [rule, n] of Object.entries(counts)) {
  const bad = failures.filter((f) => f.rule === rule);
  console.log(`  ${bad.length ? 'FAIL' : 'pass'}  ${rule}  (${n} checks)`);
  for (const f of bad) console.log(`          e.g. ${f.detail}`);
}
console.log('\nGaming strategies (measured):');
for (const line of g) console.log('  ' + line);
if (failures.length) process.exitCode = 1;
