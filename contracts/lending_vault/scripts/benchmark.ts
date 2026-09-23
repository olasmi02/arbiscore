/**
 * Gas benchmark: identical ArbiScore v2 model in Rust/Stylus vs Solidity/EVM.
 *
 *   STYLUS_ENGINE_ADDRESS=0x... SOLIDITY_ENGINE_ADDRESS=0x... \
 *     npx hardhat run scripts/benchmark.ts --network arbitrumSepolia
 *
 * Both engines must be owned by the deployer (owner may call setMockProfile / onLoanClosed).
 * Execution gas = estimateGas(call) - estimateGas(same calldata to a code-less address), which
 * removes the 21k intrinsic cost, calldata cost and Arbitrum's L1 data fee from both sides.
 * Omit STYLUS_ENGINE_ADDRESS to benchmark only the Solidity engine (e.g. on the local network).
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const HISTORY_SIZES = [0, 8, 32, 64];
const ENSEMBLE_HORIZONS = [1, 4, 16]; // richer-model benchmark at 64 loans
const RUNS = 3;
const NO_CODE = "0x000000000000000000000000000000000000dEaD";

const ENGINE_ABI = [
  "function calculateScore(address) view returns (uint16)",
  "function onLoanClosed(address,uint32,bool) returns (uint16)",
  "function setMockProfile(address,uint32,uint32,uint256,uint64[],uint32[],uint8[],uint32[]) returns (uint16)",
  "function demoMode() view returns (bool)",
  "function scoreEnsemble(address,uint32) view returns (uint16)",
  "function setDemoMode(bool)",
];

// Deterministic mixed history: mostly repaid (some late), some liquidated; the last loan is open.
function history(n: number) {
  const a: number[] = [], d: number[] = [], s: number[] = [], l: number[] = [];
  for (let i = 0; i < n; i++) {
    a.push(500 + ((i * 7919) % 20_000));
    d.push(10 + (n - i) * 12);
    s.push(i === n - 1 ? 0 : i % 7 === 3 ? 2 : 1);
    l.push(i % 5 === 1 ? 9 : 0);
  }
  return [a, d, s, l] as const;
}

async function execGas(to: string, data: string, from: string): Promise<bigint> {
  let best = 0n;
  for (let r = 0; r < RUNS; r++) {
    const [withCode, noCode] = await Promise.all([
      ethers.provider.estimateGas({ from, to, data }),
      ethers.provider.estimateGas({ from, to: NO_CODE, data }),
    ]);
    const g = withCode - noCode;
    best = r === 0 || g < best ? g : best;
  }
  return best;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const engines: Record<string, string> = {};
  if (process.env.STYLUS_ENGINE_ADDRESS) engines["Stylus (Rust)"] = process.env.STYLUS_ENGINE_ADDRESS;
  if (process.env.SOLIDITY_ENGINE_ADDRESS) {
    engines["Solidity"] = process.env.SOLIDITY_ENGINE_ADDRESS;
  } else {
    // SolidityScoreEngine + the same read-only scoreEnsemble() the Stylus engine has
    const sol = await (await ethers.getContractFactory("BenchScoreEngine")).deploy();
    await sol.waitForDeployment();
    await (await sol.init(deployer.address, deployer.address)).wait();
    engines["Solidity"] = await sol.getAddress();
    console.log(`Deployed BenchScoreEngine (Solidity baseline) at ${engines["Solidity"]}`);
  }

  const iface = new ethers.Interface(ENGINE_ABI);
  const runId = Date.now();
  const rows: { engine: string; loans: number; score: number; readGas: bigint; closeGas: bigint | null }[] = [];
  const ensembleRows: { engine: string; horizons: number; score: number; gas: bigint }[] = [];

  for (const [name, addr] of Object.entries(engines)) {
    const engine = new ethers.Contract(addr, ENGINE_ABI, deployer);
    // Seeding benchmark profiles needs demo mode (owner writes); restore the previous state afterwards
    const demoWasOn: boolean = await engine.demoMode();
    if (!demoWasOn) await (await engine.setDemoMode(true)).wait();
    for (const n of HISTORY_SIZES) {
      // Fresh address per run: the engine never rewrites a history that has an open loan
      const user = ethers.getAddress(ethers.dataSlice(ethers.id(`bench:${runId}:${n}`), 12));
      const [a, d, s, l] = history(n);
      await (await engine.setMockProfile(user, 540, 140, 48_000, a, d, s, l)).wait();
      const score = Number(await engine.calculateScore(user));
      const readGas = await execGas(addr, iface.encodeFunctionData("calculateScore", [user]), deployer.address);
      const closeGas =
        n > 0
          ? await execGas(addr, iface.encodeFunctionData("onLoanClosed", [user, n - 1, false]), deployer.address)
          : null;
      rows.push({ engine: name, loans: n, score, readGas, closeGas });
      if (n === 64) {
        for (const k of ENSEMBLE_HORIZONS) {
          const eScore = Number(await engine.scoreEnsemble(user, k));
          const gas = await execGas(addr, iface.encodeFunctionData("scoreEnsemble", [user, k]), deployer.address);
          ensembleRows.push({ engine: name, horizons: k, score: eScore, gas });
          console.log(`${name.padEnd(14)} ensemble k=${k} score=${eScore} gas=${gas}`);
        }
      }
      console.log(`${name.padEnd(14)} loans=${String(n).padStart(2)} score=${score} calculateScore=${readGas} onLoanClosed=${closeGas ?? "-"}`);
    }
    if (!demoWasOn) await (await engine.setDemoMode(false)).wait();
  }

  // Scores must agree across engines (same model, same inputs).
  for (const n of HISTORY_SIZES) {
    const scores = new Set(rows.filter((r) => r.loans === n).map((r) => r.score));
    if (scores.size > 1) throw new Error(`Engines disagree at ${n} loans: ${[...scores].join(" vs ")}`);
  }
  for (const k of ENSEMBLE_HORIZONS) {
    const scores = new Set(ensembleRows.filter((r) => r.horizons === k).map((r) => r.score));
    if (scores.size > 1) throw new Error(`Engines disagree on ensemble k=${k}: ${[...scores].join(" vs ")}`);
  }

  let md = `# ArbiScore v2 gas benchmark\n\nNetwork: \`${network.name}\` · ${new Date().toISOString()}\n\n`;
  md += "Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of " + RUNS + " estimates.\n\n";
  md += "| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |\n";
  md += "|---|---|---|---|---|---|---|---|\n";
  for (const n of HISTORY_SIZES) {
    const sol = rows.find((r) => r.loans === n && r.engine === "Solidity")!;
    const sty = rows.find((r) => r.loans === n && r.engine === "Stylus (Rust)");
    const ratio = (x?: bigint | null, y?: bigint | null) => (x && y ? `${(Number(x) / Number(y)).toFixed(2)}x` : "-");
    md += `| ${n} | ${sol.score} | ${sol.readGas} | ${sty?.readGas ?? "-"} | ${ratio(sol.readGas, sty?.readGas)} | ${sol.closeGas ?? "-"} | ${sty?.closeGas ?? "-"} | ${ratio(sol.closeGas, sty?.closeGas)} |\n`;
  }
  if (ensembleRows.some((r) => r.engine === "Stylus (Rust)")) {
    md += "\n## Richer model: ensemble over k recency horizons (64 loans)\n\n";
    md += "`scoreEnsemble(user, k)` reads the same 64 loans once and runs the model k times with different recency half-lives, ";
    md += "so storage stays fixed while arithmetic grows. Both engines return identical scores.\n\n";
    md += "| k (model evaluations) | Score | Solidity gas | Stylus gas | Stylus advantage |\n|---|---|---|---|---|\n";
    for (const k of ENSEMBLE_HORIZONS) {
      const sol = ensembleRows.find((r) => r.horizons === k && r.engine === "Solidity")!;
      const sty = ensembleRows.find((r) => r.horizons === k && r.engine === "Stylus (Rust)")!;
      md += `| ${k} | ${sol.score} | ${sol.gas} | ${sty.gas} | ${(Number(sol.gas) / Number(sty.gas)).toFixed(2)}x |\n`;
    }
  }
  const outDir = path.join(__dirname, "../../../benchmarks");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `gas_${network.name}.md`);
  fs.writeFileSync(file, md);
  console.log(`\n${md}\nWritten to ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
