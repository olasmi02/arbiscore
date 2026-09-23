/**
 * Adversarial scenarios against a local deployment of the real contracts (vault + Solidity engine,
 * which runs the same model as the Stylus engine). Reports what actually happens, so weak spots show
 * up as numbers rather than assumptions.
 *
 *   npx hardhat run scripts/scenarios.ts
 */
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const USDG = (n: number) => ethers.parseUnits(String(n), 6);
const ETH = (n: number) => ethers.parseEther(String(n));
const DAY = 86_400;

async function main() {
  const signers = await ethers.getSigners();
  const [owner, lender, stranger, liquidator] = signers;
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const usdg = await ERC20.deploy("Global Dollar", "USDG", 6);
  const weth = await ERC20.deploy("Wrapped Ether", "WETH", 18);
  const oracle = await (await ethers.getContractFactory("MockPriceOracle")).deploy(ETH(3000));
  const engine = await (await ethers.getContractFactory("SolidityScoreEngine")).deploy();
  const vault = await (await ethers.getContractFactory("ArbiCreditVault")).deploy(
    await engine.getAddress(), await oracle.getAddress(), await usdg.getAddress(), await weth.getAddress()
  );
  await engine.init(owner.address, await vault.getAddress());
  const v = await vault.getAddress();
  let next = 4;
  const fund = async (s: any) => {
    await usdg.mint(s.address, USDG(10_000_000)); await weth.mint(s.address, ETH(10_000));
    await usdg.connect(s).approve(v, ethers.MaxUint256); await weth.connect(s).approve(v, ethers.MaxUint256);
  };
  for (const s of signers.slice(0, 20)) await fund(s);
  await vault.connect(lender).deposit(USDG(5_000_000), lender.address);
  const freshWallet = () => signers[next++];
  const score = async (a: string) => Number(await engine.calculateScore(a));
  const tier = (s: number) => (s >= 750 ? "Prime" : s >= 680 ? "Near-Prime" : s >= 600 ? "Moderate" : "Subprime");
  const report: string[] = [];
  const say = (s: string) => { report.push(s); console.log(s); };

  // S1 Dust farming: a fresh wallet opens 64 x $1 loans at once, holds 15 days, repays all
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(1));
    const before = await score(w.address);
    const ids: bigint[] = [];
    let gasBorrow = 0n;
    for (let i = 0; i < 64; i++) {
      const tx = await vault.connect(w).borrow(USDG(1)); const r = await tx.wait();
      gasBorrow += r!.gasUsed; ids.push((await vault.nextLoanId()) - 1n);
    }
    await time.increase(15 * DAY);
    let interest = 0n;
    for (const id of ids) {
      const debt = await vault.debtOf(id); interest += debt - USDG(1);
      await vault.connect(w).repay(id);
    }
    const after = await score(w.address);
    say(`S1 dust farming: fresh wallet ${before} -> ${after} (${tier(after)}) after 64 x $1 loans held 15 days; total interest paid ${ethers.formatUnits(interest, 6)} USDG; avg borrow gas ${gasBorrow / 64n}`);
    // what can it borrow now?
    const q = await vault.getBorrowQuote(w.address, USDG(100_000));
    say(`   -> it can now borrow $100,000 at ${Number(q.requiredRatioBps) / 100}% collateral`);
  }

  // S2 Burying liquidations: two real liquidations, then 64 x $1 loans push them out of the window
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(20));
    for (let k = 0; k < 2; k++) {
      await vault.connect(w).borrow(USDG(4_000));
      const id = (await vault.nextLoanId()) - 1n;
      await time.increase(34 * DAY); // past due + grace: liquidatable even when healthy
      await vault.connect(liquidator).liquidate(id);
    }
    const afterLiq = await score(w.address);
    const ids: bigint[] = [];
    for (let i = 0; i < 64; i++) { await vault.connect(w).borrow(USDG(1)); ids.push((await vault.nextLoanId()) - 1n); }
    await time.increase(15 * DAY);
    for (const id of ids) await vault.connect(w).repay(id);
    const buried = await score(w.address);
    say(`S2 burying liquidations: after 2 liquidations ${afterLiq} (${tier(afterLiq)}) -> after 64 x $1 loans ${buried} (${tier(buried)})`);
  }

  // S3 Splitting: $10,000 as one loan vs ten $1,000 loans, same holding period
  {
    const a = freshWallet(), b = freshWallet();
    for (const w of [a, b]) await vault.connect(w).depositCollateral(ETH(60));
    await vault.connect(a).borrow(USDG(10_000)); const ida = (await vault.nextLoanId()) - 1n;
    const idsb: bigint[] = [];
    for (let i = 0; i < 10; i++) { await vault.connect(b).borrow(USDG(1_000)); idsb.push((await vault.nextLoanId()) - 1n); }
    await time.increase(15 * DAY);
    await vault.connect(a).repay(ida); for (const id of idsb) await vault.connect(b).repay(id);
    say(`S3 splitting: one $10,000 loan -> ${await score(a.address)}; ten $1,000 loans -> ${await score(b.address)}`);
  }

  // S4 A stranger repays someone else's loan: who gets the collateral and the credit?
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(10));
    await vault.connect(w).borrow(USDG(5_000)); const id = (await vault.nextLoanId()) - 1n;
    await time.increase(15 * DAY);
    const freeBefore = await vault.getFreeCollateral(w.address);
    const strangerBefore = await usdg.balanceOf(stranger.address);
    await vault.connect(stranger).repay(id);
    const paid = strangerBefore - (await usdg.balanceOf(stranger.address));
    const freeAfter = await vault.getFreeCollateral(w.address);
    say(`S4 third-party repayment: stranger paid ${ethers.formatUnits(paid, 6)} USDG; borrower's free collateral ${ethers.formatEther(freeBefore)} -> ${ethers.formatEther(freeAfter)} ETH; borrower score ${await score(w.address)}`);
  }

  // S5 Tiny loans and interest: does a $1 loan actually pay interest?
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(1));
    await vault.connect(w).borrow(USDG(1)); const id = (await vault.nextLoanId()) - 1n;
    await time.increase(15 * DAY);
    say(`S5 interest on a $1 loan after 15 days: ${ethers.formatUnits((await vault.debtOf(id)) - USDG(1), 6)} USDG`);
  }

  // S6 Borrowing again while a loan is overdue (unpaid, not yet liquidated)
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(20));
    await vault.connect(w).borrow(USDG(2_000));
    await time.increase(40 * DAY);
    const s = await score(w.address);
    let result = "allowed";
    try { await vault.connect(w).borrow(USDG(1_000)); } catch (e: any) { result = `rejected (${e.shortMessage ?? e.message})`.slice(0, 90); }
    const q = await vault.getBorrowQuote(w.address, USDG(1_000));
    say(`S6 new borrow while 10 days overdue: ${result}; score ${s}, quoted at ${Number(q.requiredRatioBps) / 100}%`);
  }

  // S7 Self-liquidation of an overdue loan: does the borrower profit or dodge anything?
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(5));
    await vault.connect(w).borrow(USDG(3_000)); const id = (await vault.nextLoanId()) - 1n;
    await time.increase(34 * DAY);
    const wethBefore = await weth.balanceOf(w.address), usdgBefore = await usdg.balanceOf(w.address);
    await vault.connect(w).liquidate(id);
    const gotWeth = (await weth.balanceOf(w.address)) - wethBefore;
    const paidUsdg = usdgBefore - (await usdg.balanceOf(w.address));
    say(`S7 self-liquidation: paid ${ethers.formatUnits(paidUsdg, 6)} USDG, received ${ethers.formatEther(gotWeth)} WETH (worth $${(Number(ethers.formatEther(gotWeth)) * 3000).toFixed(2)}); recorded as a liquidation, score ${await score(w.address)}`);
  }

  // S8 Late repayment is recorded as late
  {
    const a = freshWallet(), b = freshWallet();
    for (const w of [a, b]) { await vault.connect(w).depositCollateral(ETH(10)); await vault.connect(w).borrow(USDG(3_000)); }
    const ida = (await vault.nextLoanId()) - 2n, idb = ida + 1n;
    await time.increase(29 * DAY); await vault.connect(a).repay(ida);
    await time.increase(20 * DAY); await vault.connect(b).repay(idb); // 19 days late
    say(`S8 on-time repayment -> ${await score(a.address)}; 19 days late -> ${await score(b.address)}`);
  }

  // S9 Gas stays bounded as history grows past the 64-loan window
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(5));
    const gas: number[] = [];
    for (let i = 0; i < 130; i++) {
      const r = await (await vault.connect(w).borrow(USDG(1))).wait();
      if ([0, 63, 129].includes(i)) gas.push(Number(r!.gasUsed));
      await vault.connect(w).repay((await vault.nextLoanId()) - 1n);
    }
    say(`S9 borrow gas at loan #1 / #64 / #130: ${gas.join(" / ")}`);
  }

  // S10 Price crash below 100%: bad debt and who absorbs it
  {
    const w = freshWallet();
    await vault.connect(w).depositCollateral(ETH(2));
    await vault.connect(w).borrow(USDG(3_900)); const id = (await vault.nextLoanId()) - 1n; // ~150% at $3000 (Subprime)
    const sharePriceBefore = await vault.convertToAssets(ETH(1));
    await oracle.setEthPriceUSD(ETH(1500));
    await vault.connect(liquidator).liquidate(id);
    const sharePriceAfter = await vault.convertToAssets(ETH(1));
    await oracle.setEthPriceUSD(ETH(3000));
    say(`S10 ETH halves after borrowing: liquidated with bad debt; lender share price ${ethers.formatUnits(sharePriceBefore, 6)} -> ${ethers.formatUnits(sharePriceAfter, 6)}`);
  }

  console.log("\n" + report.length + " scenarios run.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
