import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ArbiCreditVault, MockERC20, MockPriceOracle, SolidityScoreEngine } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const OPEN = 0, REPAID = 1, LIQUIDATED = 2;
const USDG = (n: number | string) => ethers.parseUnits(String(n), 6);
const ETH = (n: number | string) => ethers.parseEther(String(n));
const PRICE = ETH(3000); // $3,000 / ETH, 18 decimals
const YEAR = 365n * 86400n;

describe("ArbiCreditVault: two-sided USDG credit market", function () {
  let vault: ArbiCreditVault;
  let usdg: MockERC20;
  let weth: MockERC20;
  let oracle: MockPriceOracle;
  let engine: SolidityScoreEngine;
  let owner: HardhatEthersSigner, lender: HardhatEthersSigner, prime: HardhatEthersSigner;
  let subprime: HardhatEthersSigner, moderate: HardhatEthersSigner, liquidator: HardhatEthersSigner;

  async function setProfile(user: string, ageDays: number, txs: number, vol: number, loans: number[][]) {
    await engine.setMockProfile(
      user, ageDays, txs, vol,
      loans.map((l) => l[0]), loans.map((l) => l[1]), loans.map((l) => l[2]), loans.map((l) => l[3] ?? 0)
    );
  }

  beforeEach(async function () {
    [owner, lender, prime, subprime, moderate, liquidator] = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("MockERC20");
    usdg = (await ERC20.deploy("Global Dollar", "USDG", 6)) as MockERC20;
    weth = (await ERC20.deploy("Wrapped Ether", "WETH", 18)) as MockERC20;
    oracle = (await (await ethers.getContractFactory("MockPriceOracle")).deploy(PRICE)) as MockPriceOracle;
    engine = (await (await ethers.getContractFactory("SolidityScoreEngine")).deploy()) as SolidityScoreEngine;
    vault = (await (await ethers.getContractFactory("ArbiCreditVault")).deploy(
      await engine.getAddress(), await oracle.getAddress(), await usdg.getAddress(), await weth.getAddress()
    )) as ArbiCreditVault;
    await engine.init(owner.address, await vault.getAddress());

    // Prime (Alice persona, 812), Subprime (Bob persona, 442), Moderate (655)
    await setProfile(prime.address, 540, 140, 48000, [
      [2000, 500, REPAID], [3500, 430, REPAID], [5000, 360, REPAID], [4000, 290, REPAID],
      [8000, 220, REPAID], [6000, 150, REPAID], [12000, 90, REPAID], [15000, 45, REPAID], [10000, 10, OPEN],
    ]);
    await setProfile(subprime.address, 200, 220, 30000, [
      [3000, 190, REPAID, 12], [5000, 160, LIQUIDATED], [2000, 130, REPAID],
      [4000, 95, LIQUIDATED], [1500, 60, REPAID, 5], [2500, 12, OPEN],
    ]);
    await setProfile(moderate.address, 100, 25, 2000, [[600, 70, REPAID]]);

    const v = await vault.getAddress();
    for (const s of [lender, prime, subprime, moderate, liquidator]) {
      await usdg.mint(s.address, USDG(1_000_000));
      await weth.mint(s.address, ETH(100));
      await usdg.connect(s).approve(v, ethers.MaxUint256);
      await weth.connect(s).approve(v, ethers.MaxUint256);
    }
    await vault.connect(lender).deposit(USDG(100_000), lender.address);
  });

  describe("Lender side (ERC-4626)", function () {
    it("mints shares for supplied USDG and names the share token after the asset", async function () {
      expect(await vault.symbol()).to.equal("asUSDG");
      expect(await vault.totalAssets()).to.equal(USDG(100_000));
      expect(await vault.maxWithdraw(lender.address)).to.equal(USDG(100_000));
    });

    it("pays borrower interest to lenders through the share price", async function () {
      await vault.connect(prime).depositCollateral(ETH(20));
      await vault.connect(prime).borrow(USDG(50_000));
      const before = await vault.convertToAssets(ETH(1));
      await time.increase(20 * 86400);
      expect(await vault.accruedInterest()).to.be.greaterThan(0n);
      await vault.connect(prime).repay(1);
      const after = await vault.convertToAssets(ETH(1));
      expect(after).to.be.greaterThan(before);
      expect(await vault.maxWithdraw(lender.address)).to.be.greaterThan(USDG(100_000));
    });

    it("limits lender withdrawals to idle cash while funds are lent out", async function () {
      await vault.connect(prime).depositCollateral(ETH(30));
      await vault.connect(prime).borrow(USDG(80_000));
      expect(await vault.maxWithdraw(lender.address)).to.equal(USDG(20_000));
      await expect(vault.connect(lender).withdraw(USDG(30_000), lender.address, lender.address)).to.be.reverted;
    });
  });

  describe("Borrowing at tier ratios", function () {
    it("lets a Prime borrower take $10,000 against 3.5 ETH (105%)", async function () {
      await vault.connect(prime).depositCollateral(ETH(3.5));
      await expect(vault.connect(prime).borrow(USDG(10_000))).to.emit(vault, "LoanCreated");
      const loan = await vault.loans(1);
      expect(loan.collateralLocked).to.equal(ETH(3.5));
      expect(loan.borrowRatioBps).to.equal(10500);
      expect(loan.liqThresholdBps).to.equal(10300);
      expect(await vault.getFreeCollateral(prime.address)).to.equal(0);
    });

    it("rejects a Subprime borrower at 105% and accepts them at 150%", async function () {
      await vault.connect(subprime).depositCollateral(ETH(3.5));
      await expect(vault.connect(subprime).borrow(USDG(10_000)))
        .to.be.revertedWithCustomError(vault, "InsufficientFreeCollateral")
        .withArgs(ETH(3.5), ETH(5));
      await vault.connect(subprime).depositCollateral(ETH(1.5));
      await vault.connect(subprime).borrow(USDG(10_000));
      expect((await vault.loans(1)).collateralLocked).to.equal(ETH(5));
    });

    it("quotes collateral savings vs a 150% baseline per tier", async function () {
      const q = await vault.getBorrowQuote(prime.address, USDG(10_000));
      expect(q.requiredCollateralWei).to.equal(ETH(3.5));
      expect(q.traditionalCollateralWei).to.equal(ETH(5));
      expect(q.collateralSavedUSD).to.equal(4500n);
      expect((await vault.getBorrowQuote(moderate.address, USDG(10_000))).collateralSavedUSD).to.equal(2000n);
      expect((await vault.getBorrowQuote(subprime.address, USDG(10_000))).collateralSavedUSD).to.equal(0n);
    });

    it("prices risk: lower tiers and higher utilization pay more", async function () {
      const small = USDG(1_000);
      const primeApr = (await vault.getBorrowQuote(prime.address, small)).aprBps;
      const subApr = (await vault.getBorrowQuote(subprime.address, small)).aprBps;
      expect(subApr - primeApr).to.equal(500n);
      expect(await vault.quoteAprBps(3, USDG(90_000))).to.be.greaterThan(await vault.quoteAprBps(3, small));
    });

    it("rejects dust borrows and borrows above available liquidity", async function () {
      await vault.connect(prime).depositCollateral(ETH(100));
      await expect(vault.connect(prime).borrow(USDG("0.5"))).to.be.revertedWithCustomError(vault, "BorrowTooSmall");
      await expect(vault.connect(prime).borrow(USDG(100_001))).to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
    });
  });

  describe("Repayment and the credit feedback loop", function () {
    it("charges principal + interest, unlocks collateral and closes the loan in the engine", async function () {
      await vault.connect(moderate).depositCollateral(ETH(10));
      await vault.connect(moderate).borrow(USDG(3_000));
      const loan = await vault.loans(1);
      await time.increase(15 * 86400);
      const before = await usdg.balanceOf(moderate.address);
      await vault.connect(moderate).repay(1);
      const paid = before - (await usdg.balanceOf(moderate.address));
      const elapsed = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) - loan.borrowTimestamp;
      const expectedInterest = (loan.principal * loan.aprBps * elapsed + 10_000n * YEAR - 1n) / (10_000n * YEAR);
      expect(paid).to.equal(loan.principal + expectedInterest);
      expect(await vault.userLockedCollateral(moderate.address)).to.equal(0);
      const hist = await engine.getLoanHistory(moderate.address);
      expect(hist.statuses[loan.engineIndex]).to.equal(REPAID);
    });

    it("raises the score after a seasoned (15-day) on-time repayment", async function () {
      await vault.connect(moderate).depositCollateral(ETH(10));
      const before = await engine.calculateScore(moderate.address);
      await vault.connect(moderate).borrow(USDG(3_000));
      await time.increase(15 * 86400);
      await vault.connect(moderate).repay(1);
      expect(await engine.calculateScore(moderate.address)).to.be.greaterThan(before);
    });

    it("gives no credit for instant borrow/repay loops (wash-borrowing)", async function () {
      const fresh = liquidator; // no ArbiScore history yet
      await vault.connect(fresh).depositCollateral(ETH(100));
      await vault.connect(fresh).borrow(USDG(1_000)); // initializes the profile
      await vault.connect(fresh).repay(1);
      const baseline = await engine.calculateScore(fresh.address);
      for (let i = 2; i <= 6; i++) {
        await vault.connect(fresh).borrow(USDG(40_000));
        await vault.connect(fresh).repay(i);
      }
      const after = await engine.calculateScore(fresh.address);
      expect(after).to.be.lessThanOrEqual(baseline + 2n); // only wallet age ticks by a few seconds
      expect(after).to.be.lessThan(600n);
    });
  });

  describe("Liquidation", function () {
    beforeEach(async function () {
      await vault.connect(prime).depositCollateral(ETH(3.5));
      await vault.connect(prime).borrow(USDG(10_000)); // 105%, liquidation threshold 103%
      await vault.connect(moderate).depositCollateral(ETH(20)); // bystander collateral
    });

    it("is not liquidatable after a small price dip that stays above the threshold", async function () {
      await oracle.setEthPriceUSD(ETH(2960)); // 3.5 ETH = $10,360 > 103% of debt
      expect(await vault.isLiquidatable(1)).to.equal(false);
      await expect(vault.connect(liquidator).liquidate(1)).to.be.revertedWithCustomError(vault, "LoanNotLiquidatable");
    });

    it("pays the liquidator debt + tier bonus from the borrower's collateral only", async function () {
      await oracle.setEthPriceUSD(ETH(2940)); // 3.5 ETH = $10,290 < 103% of debt ($10,300)
      expect(await vault.isLiquidatable(1)).to.equal(true);
      const debt = await vault.debtOf(1);
      const wethBefore = await weth.balanceOf(liquidator.address);
      await expect(vault.connect(liquidator).liquidate(1)).to.emit(vault, "LoanLiquidated");
      const seized = (await weth.balanceOf(liquidator.address)) - wethBefore;
      // Prime bonus = (10300 - 10000) / 2 = 1.5%
      const expected = (debt * 10n ** 12n * 10150n * ETH(1) + 10_000n * ETH(2940) - 1n) / (10_000n * ETH(2940));
      expect(expected).to.be.lessThan(ETH(3.5));
      expect(seized).to.be.closeTo(expected, ETH("0.000001")); // one extra second of interest accrues
      expect(await vault.getFreeCollateral(prime.address)).to.equal(ETH(3.5) - seized); // remainder returned
      expect(await vault.userCollateral(moderate.address)).to.equal(ETH(20)); // bystander untouched
      expect(await weth.balanceOf(await vault.getAddress())).to.equal(
        (await vault.userCollateral(prime.address)) + (await vault.userCollateral(moderate.address))
      );
      const hist = await engine.getLoanHistory(prime.address);
      expect(hist.statuses[hist.statuses.length - 1]).to.equal(LIQUIDATED);
    });

    it("socializes bad debt to lenders instead of taking other users' collateral", async function () {
      await oracle.setEthPriceUSD(ETH(2000)); // 3.5 ETH = $7,000 << $10,000 debt
      const assetsBefore = await vault.totalAssets();
      await vault.connect(liquidator).liquidate(1);
      expect(await weth.balanceOf(liquidator.address)).to.equal(ETH(103.5)); // got all 3.5 ETH
      expect(await vault.userCollateral(moderate.address)).to.equal(ETH(20));
      expect(await vault.totalAssets()).to.be.lessThan(assetsBefore);
      expect(await vault.totalPrincipal()).to.equal(0);
    });

    it("allows liquidation of a healthy loan only after due date + grace period", async function () {
      await time.increase(30 * 86400 + 2 * 86400);
      expect(await vault.isLiquidatable(1)).to.equal(false);
      await time.increase(2 * 86400);
      expect(await vault.isLiquidatable(1)).to.equal(true);
    });

    it("rejects liquidating a repaid or already-liquidated loan", async function () {
      await oracle.setEthPriceUSD(ETH(2900));
      await vault.connect(liquidator).liquidate(1);
      await expect(vault.connect(liquidator).liquidate(1)).to.be.revertedWithCustomError(vault, "LoanNotActive");
      await expect(vault.connect(prime).repay(1)).to.be.revertedWithCustomError(vault, "LoanNotActive");
      await expect(vault.connect(prime).repay(99)).to.be.revertedWithCustomError(vault, "LoanNotFound");
    });
  });

  describe("Admin & safety", function () {
    it("pause blocks new supply/collateral/borrows but never repay, withdrawals or redemptions", async function () {
      await vault.connect(prime).depositCollateral(ETH(10));
      await vault.connect(prime).borrow(USDG(1_000));
      await expect(vault.connect(prime).pause()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await vault.pause();
      await expect(vault.connect(prime).borrow(USDG(1_000))).to.be.revertedWithCustomError(vault, "EnforcedPause");
      await expect(vault.connect(lender).deposit(USDG(1), lender.address)).to.be.reverted;
      await expect(vault.connect(prime).depositCollateral(ETH(1))).to.be.revertedWithCustomError(vault, "EnforcedPause");
      await vault.connect(prime).repay(1);
      await vault.connect(prime).withdrawCollateral(ETH(10));
      await vault.connect(lender).withdraw(USDG(1_000), lender.address, lender.address);
    });

    it("only the vault or owner can write loan outcomes to the engine", async function () {
      await expect(engine.connect(prime).onLoanOpened(prime.address, 1000, 0)).to.be.revertedWithCustomError(
        engine,
        "Unauthorized"
      );
    });
  });

  describe("Invariants under random operation sequences", function () {
    it("keeps collateral fully backed and credit accounting exact across 150 random actions", async function () {
      this.timeout(300_000);
      let seed = 1234567;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed % n;
      };
      const actors = [prime, subprime, moderate];
      const active: number[] = [];
      let lastSharePrice = await vault.convertToAssets(ETH(1));

      for (let step = 0; step < 150; step++) {
        const who = actors[rnd(actors.length)];
        const op = rnd(7);
        let hadBadDebt = false;
        try {
          if (op === 0) await vault.connect(who).depositCollateral(ETH(1 + rnd(10)));
          else if (op === 1) {
            const free = await vault.getFreeCollateral(who.address);
            if (free > 0n) await vault.connect(who).withdrawCollateral(free / 2n + 1n);
          } else if (op === 2) {
            const tx = await vault.connect(who).borrow(USDG(100 + rnd(8_000)));
            await tx.wait();
            active.push(Number(await vault.nextLoanId()) - 1);
          } else if (op === 3 && active.length) {
            const id = active.splice(rnd(active.length), 1)[0];
            const l = await vault.loans(id);
            await vault.connect(actors.find((a) => a.address === l.borrower)!).repay(id);
          } else if (op === 4) await time.increase(1 + rnd(10) * 86400);
          else if (op === 5) await oracle.setEthPriceUSD(ETH(1500 + rnd(2500)));
          else if (op === 6 && active.length) {
            const id = active[rnd(active.length)];
            if (await vault.isLiquidatable(id)) {
              const r = await (await vault.connect(liquidator).liquidate(id)).wait();
              const ev = r!.logs.map((x) => vault.interface.parseLog(x)).find((e) => e?.name === "LoanLiquidated");
              hadBadDebt = ev!.args.badDebt > 0n;
              active.splice(active.indexOf(id), 1);
            }
          }
        } catch (e: any) {
          // Expected business reverts (insufficient collateral/liquidity) are fine; anything else is a bug.
          if (!/InsufficientFreeCollateral|InsufficientLiquidity/.test(e.message)) throw e;
        }

        // 1. Collateral held == sum of user collateral; locked <= deposited
        let sumCollateral = 0n;
        for (const a of actors) {
          const c = await vault.userCollateral(a.address);
          expect(await vault.userLockedCollateral(a.address)).to.be.lessThanOrEqual(c);
          sumCollateral += c;
        }
        expect(await weth.balanceOf(await vault.getAddress())).to.equal(sumCollateral);

        // 2. totalPrincipal == sum of active principal; locked == sum of active loans' collateral
        let principal = 0n;
        const locked: Record<string, bigint> = {};
        for (const id of active) {
          const l = await vault.loans(id);
          principal += l.principal;
          locked[l.borrower] = (locked[l.borrower] ?? 0n) + l.collateralLocked;
        }
        expect(await vault.totalPrincipal()).to.equal(principal);
        for (const a of actors) expect(await vault.userLockedCollateral(a.address)).to.equal(locked[a.address] ?? 0n);

        // 3. Lender share price never falls except through realized bad debt
        const sharePrice = await vault.convertToAssets(ETH(1));
        if (!hadBadDebt) expect(sharePrice).to.be.greaterThanOrEqual(lastSharePrice - 1n);
        lastSharePrice = sharePrice;
      }
    });
  });
});
