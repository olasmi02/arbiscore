import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ModelHarness, SolidityScoreEngine } from "../typechain-types";

const VECTORS = path.join(__dirname, "../../test_vectors/score_vectors.txt");

describe("ArbiScore v2 model & engine", function () {
  describe("Cross-implementation vectors", function () {
    it("Solidity model reproduces every TypeScript reference score bit-for-bit", async function () {
      this.timeout(120_000);
      const harness = (await (await ethers.getContractFactory("ModelHarness")).deploy()) as ModelHarness;
      const lines = fs.readFileSync(VECTORS, "utf8").trim().split("\n");
      expect(lines.length).to.be.greaterThan(400);
      for (const [i, line] of lines.entries()) {
        const [head, loanStr] = line.split("|");
        const [expected, first, txs, vol, now] = head.trim().split(/\s+/).map(BigInt);
        const loans = loanStr
          ? loanStr.split(";").map((l) => {
              const [amountUsd, borrowTs, dueTs, closeTs, status] = l.split(",").map(BigInt);
              return { amountUsd, borrowTs, dueTs, closeTs, status };
            })
          : [];
        const got = await harness.computeScore(first, txs, vol, loans, now);
        expect(got, `vector ${i}`).to.equal(expected);
      }
    });
  });

  describe("Engine access control & history", function () {
    let engine: SolidityScoreEngine;
    let owner: any, vault: any, alice: any, bob: any;

    beforeEach(async function () {
      [owner, vault, alice, bob] = await ethers.getSigners();
      engine = (await (await ethers.getContractFactory("SolidityScoreEngine")).deploy()) as SolidityScoreEngine;
      await engine.init(owner.address, vault.address);
    });

    it("uninitialized wallets score 300 (Subprime)", async function () {
      expect(await engine.calculateScore(alice.address)).to.equal(300);
      const [score, tier, ratio] = await engine.getScoreAndTier(alice.address);
      expect([score, tier, ratio]).to.deep.equal([300n, 0n, 12500n]);
    });

    it("demo mode lets a user set only their own profile, and the owner can turn it off", async function () {
      expect(await engine.demoMode()).to.equal(false); // new engines start with demo mode off
      await expect(
        engine.connect(alice).setMockProfile(alice.address, 100, 25, 2000, [], [], [], [])
      ).to.be.revertedWithCustomError(engine, "DemoModeDisabled");
      await engine.setDemoMode(true);
      await engine.connect(alice).setMockProfile(alice.address, 100, 25, 2000, [600], [70], [1], [0]);
      expect(await engine.calculateScore(alice.address)).to.equal(690);

      await expect(
        engine.connect(alice).setMockProfile(bob.address, 100, 25, 2000, [], [], [], [])
      ).to.be.revertedWithCustomError(engine, "Unauthorized");

      await engine.setDemoMode(false);
      await expect(
        engine.connect(alice).setMockProfile(alice.address, 100, 25, 2000, [], [], [], [])
      ).to.be.revertedWithCustomError(engine, "DemoModeDisabled");
      await expect(engine.connect(alice).setDemoMode(true)).to.be.revertedWithCustomError(engine, "Unauthorized");
    });

    it("rejects malformed mock profiles", async function () {
      await engine.setDemoMode(true);
      await expect(
        engine.setMockProfile(alice.address, 1, 1, 1, [1, 2], [1], [1, 1], [0, 0])
      ).to.be.revertedWithCustomError(engine, "InvalidProfile");
      await expect(
        engine.setMockProfile(alice.address, 1, 1, 1, [1], [1], [3], [0])
      ).to.be.revertedWithCustomError(engine, "InvalidProfile");
    });

    it("records loan lifecycle in history and blocks double-closing", async function () {
      const due = (await ethers.provider.getBlock("latest"))!.timestamp + 30 * 86400;
      await engine.connect(vault).onLoanOpened(alice.address, 5000, due);
      await engine.connect(vault).onLoanClosed(alice.address, 0, false);
      const [amounts, , dues, closes, statuses] = await engine.getLoanHistory(alice.address);
      expect(amounts).to.deep.equal([5000n]);
      expect(dues).to.deep.equal([BigInt(due)]);
      expect(closes[0]).to.be.greaterThan(0n);
      expect(statuses).to.deep.equal([1n]);
      await expect(engine.connect(vault).onLoanClosed(alice.address, 0, true)).to.be.revertedWithCustomError(
        engine,
        "LoanNotOpen"
      );
      await expect(engine.connect(vault).onLoanClosed(alice.address, 7, true)).to.be.revertedWithCustomError(
        engine,
        "InvalidLoanIndex"
      );
      await expect(engine.connect(alice).onLoanClosed(alice.address, 0, true)).to.be.revertedWithCustomError(
        engine,
        "Unauthorized"
      );
    });

    it("init cannot be hijacked after ownership is set", async function () {
      await expect(engine.connect(alice).init(alice.address, alice.address)).to.be.revertedWithCustomError(
        engine,
        "Unauthorized"
      );
    });
  });
});
