/**
 * End-to-end smoke test against the live deployment (deployments.json).
 *   ATTEST_API=http://localhost:3000 npx hardhat run scripts/smokeTest.ts --network arbitrumSepolia
 *
 *  1. A fresh wallet scores 300 (Subprime) and is quoted 150% at the live Chainlink price.
 *  2. In each market with liquidity (USDG, test USDC): borrow + instant repay pays interest, earns NO credit.
 *  3. Portable credit: a real Aave V3 (Arbitrum One) borrower's history is attested by the API and
 *     imported on-chain through CreditImporter (EIP-712), then scored by the Stylus engine.
 *  4. The Alice persona, written by the owner (demo mode briefly on, then restored), scores exactly 812.
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const { contracts: C } = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments.json"), "utf8"));
const scan = (h: string) => `https://sepolia.arbiscan.io/tx/${h}`;
const AAVE_BORROWER = "0x699e74955b470C24f9a80ce60Ce0a8FFa747b897"; // public Aave V3 Arbitrum One borrower
const ALICE = [[2000, 500, 1], [3500, 430, 1], [5000, 360, 1], [4000, 290, 1], [8000, 220, 1], [6000, 150, 1], [12000, 90, 1], [15000, 45, 1], [10000, 10, 0]];

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const newWallet = async () => {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await (await deployer.sendTransaction({ to: w.address, value: ethers.parseEther("0.002") })).wait();
    return w;
  };
  const send = async (label: string, p: Promise<any>) => {
    const tx = await p;
    const r = await tx.wait();
    console.log(`  → ${label}: ${scan(tx.hash)} (gas ${r.gasUsed})`);
    return r;
  };

  const engineRead = await ethers.getContractAt("IArbiScoreEngine", C.StylusScoreEngine);
  const vaultRead = await ethers.getContractAt("ArbiCreditVault", C.ArbiCreditVault);
  const usdg = await ethers.getContractAt("MockERC20", C.USDG);

  console.log("\n[1] Fresh wallet → Subprime, 150% at the live Chainlink price");
  const u1 = await newWallet();
  const vault = vaultRead.connect(u1);
  const weth = (await ethers.getContractAt("MockERC20", C.MockWETH)).connect(u1);
  check(Number(await engineRead.calculateScore(u1.address)) === 300, "uninitialized wallet scores 300");
  await send("faucet 1 WETH", weth.faucet(u1.address, ethers.parseEther("1")));
  await send("approve WETH", weth.approve(C.ArbiCreditVault, ethers.MaxUint256));
  await send("deposit 1 WETH", vault.depositCollateral(ethers.parseEther("1")));
  const at = { blockTag: await ethers.provider.getBlockNumber() }; // live feed: read both at one block
  const price = await (await ethers.getContractAt("ChainlinkPriceOracle", C.PriceOracle)).getEthPriceUSD(at);
  const q = await vault.getBorrowQuote(u1.address, 5_000_000n, at);
  const expected = (5_000_000n * 10n ** 12n * 15000n * 10n ** 18n + 10_000n * price - 1n) / (10_000n * price);
  check(q.requiredRatioBps === 15000n && q.requiredCollateralWei === expected, `quote: $5 needs ${ethers.formatEther(q.requiredCollateralWei)} ETH at $${ethers.formatEther(price)}/ETH`);

  console.log("\n[2] Borrow + instant repay in each liquid market (interest paid, no credit earned)");
  const markets = [
    { name: "USDG", vault: C.ArbiCreditVault, asset: C.USDG, faucet: false },
    { name: "test USDC", vault: C.ArbiCreditVaultUSDC, asset: C.TestUSDC, faucet: true },
  ].filter((m) => m.vault);
  for (const m of markets) {
    const token = (await ethers.getContractAt("MockERC20", m.asset)).connect(u1);
    const mv = (await ethers.getContractAt("ArbiCreditVault", m.vault)).connect(u1);
    const cash = await token.balanceOf(m.vault);
    if (cash < 5_000_000n) {
      console.log(`  - ${m.name}: skipped, pool has ${ethers.formatUnits(cash, 6)} liquidity`);
      continue;
    }
    if (m.vault !== C.ArbiCreditVault) {
      await send(`faucet 1 WETH (${m.name} market)`, weth.faucet(u1.address, ethers.parseEther("1")));
      await send(`approve WETH (${m.name} market)`, weth.approve(m.vault, ethers.MaxUint256));
      await send(`deposit 1 WETH (${m.name})`, mv.depositCollateral(ethers.parseEther("1")));
    }
    await send(`borrow 5 ${m.name}`, mv.borrow(5_000_000n));
    const ids = await mv.getUserLoanIds(u1.address);
    const loanId = ids[ids.length - 1];
    const scoreOpen = Number(await engineRead.calculateScore(u1.address));
    const debt = await mv.debtOf(loanId);
    check(debt >= 5_000_000n, `${m.name} debt ${ethers.formatUnits(debt, 6)} (principal + interest)`);
    // interest accrues until the repay block: top up 0.01 for it
    if (m.faucet) await send("faucet 0.01 test USDC", token.faucet(u1.address, 10_000n));
    else await send("top-up 0.01 USDG", token.connect(deployer).transfer(u1.address, 10_000n));
    await send(`approve ${m.name}`, token.approve(m.vault, ethers.MaxUint256));
    await send(`repay (${m.name})`, mv.repay(loanId));
    const scoreAfter = Number(await engineRead.calculateScore(u1.address));
    check(scoreAfter <= scoreOpen + 1, `instant repay earned no credit (${scoreOpen} → ${scoreAfter})`);
  }

  console.log("\n[3] Portable credit: import a real Aave V3 history via EIP-712 attestation");
  const api = process.env.ATTEST_API ?? "http://localhost:3000";
  const u2 = await newWallet();
  const res = await fetch(`${api}/api/attest?address=${u2.address}&demoSource=${AAVE_BORROWER}`);
  const body: any = await res.json();
  check(res.ok, `attester API signed ${body.attestation?.amountsUsd?.length} loans (${JSON.stringify(body.summary)})`);
  const importer = (await ethers.getContractAt("CreditImporter", C.CreditImporter)).connect(u2);
  const a = body.attestation;
  await send("importCredit", importer.importCredit(
    { ...a, volumeUsd: BigInt(a.volumeUsd), amountsUsd: a.amountsUsd.map(BigInt), deadline: BigInt(a.deadline) },
    body.signature
  ));
  const imported = Number(await engineRead.calculateScore(u2.address));
  check(imported > 300, `imported history scored ${imported} by the Stylus engine`);
  await importer.importCredit.staticCall(
    { ...a, volumeUsd: BigInt(a.volumeUsd), amountsUsd: a.amountsUsd.map(BigInt), deadline: BigInt(a.deadline) },
    body.signature
  ).then(
    () => check(false, "second import must fail"),
    (e: any) => {
      const name = e.data ? importer.interface.parseError(e.data)?.name : undefined;
      check(name === "AlreadyHasHistory", `second import rejected (${name ?? e.shortMessage})`);
    }
  );

  console.log("\n[4] Alice persona (written by the owner) parity with the TypeScript model");
  const u3 = await newWallet();
  // Profile writes need demo mode (off in production): enable it for this one write, then restore it
  const ownerEngine = engineRead.connect(deployer);
  const demoWasOn = await ownerEngine.demoMode();
  if (!demoWasOn) await send("demo mode on (owner)", ownerEngine.setDemoMode(true));
  await send("setMockProfile(Alice) as owner", ownerEngine.setMockProfile(
    u3.address, 540, 140, 48_000, ALICE.map((x) => x[0]), ALICE.map((x) => x[1]), ALICE.map((x) => x[2]), ALICE.map(() => 0)
  ));
  if (!demoWasOn) await send("demo mode off again", ownerEngine.setDemoMode(false));
  check(!(await engineRead.demoMode()) || demoWasOn, "demo mode restored");
  const [score, tier, ratio] = await engineRead.getScoreAndTier(u3.address);
  check(Number(score) === 812 && tier === 3n && ratio === 10500n, `Stylus score ${score} = TypeScript 812, Prime at 105%`);

  console.log("\nAll smoke checks passed against the live deployment.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
