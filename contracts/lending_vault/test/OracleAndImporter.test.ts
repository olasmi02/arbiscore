import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ChainlinkPriceOracle, CreditImporter, MockAggregator, SolidityScoreEngine } from "../typechain-types";

describe("ChainlinkPriceOracle", function () {
  let feed: MockAggregator;
  let seq: MockAggregator;
  let oracle: ChainlinkPriceOracle;

  beforeEach(async function () {
    const Agg = await ethers.getContractFactory("MockAggregator");
    feed = (await Agg.deploy(8, 2764_00000000n)) as MockAggregator;
    seq = (await Agg.deploy(0, 0)) as MockAggregator;
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await seq.set(0, now - 7200, now - 7200); // sequencer up for 2h
    oracle = (await (await ethers.getContractFactory("ChainlinkPriceOracle")).deploy(
      await feed.getAddress(), await seq.getAddress(), 3600
    )) as ChainlinkPriceOracle;
  });

  it("normalizes an 8-decimal feed to 18 decimals", async function () {
    expect(await oracle.getEthPriceUSD()).to.equal(ethers.parseEther("2764"));
  });

  it("rejects stale, zero and negative prices", async function () {
    await time.increase(3601);
    await expect(oracle.getEthPriceUSD()).to.be.revertedWithCustomError(oracle, "StalePrice");
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await feed.set(0, now, now);
    await expect(oracle.getEthPriceUSD()).to.be.revertedWithCustomError(oracle, "InvalidPrice");
    await feed.set(-1, now, now);
    await expect(oracle.getEthPriceUSD()).to.be.revertedWithCustomError(oracle, "InvalidPrice");
  });

  it("rejects prices while the L2 sequencer is down and during the restart grace period", async function () {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await seq.set(1, now, now);
    await expect(oracle.getEthPriceUSD()).to.be.revertedWithCustomError(oracle, "SequencerDown");
    await seq.set(0, now, now);
    await expect(oracle.getEthPriceUSD()).to.be.revertedWithCustomError(oracle, "SequencerGracePeriod");
  });
});

describe("CreditImporter (portable credit via EIP-712 attestation)", function () {
  let engine: SolidityScoreEngine;
  let importer: CreditImporter;
  let owner: any, attester: any, alice: any, mallory: any;

  const types = {
    CreditAttestation: [
      { name: "user", type: "address" },
      { name: "ageDays", type: "uint32" },
      { name: "txCount", type: "uint32" },
      { name: "volumeUsd", type: "uint256" },
      { name: "loansHash", type: "bytes32" },
      { name: "source", type: "string" },
      { name: "deadline", type: "uint256" },
    ],
  };

  async function attest(signer: any, user: string, overrides: Partial<Record<string, any>> = {}) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const a = {
      user,
      ageDays: 400,
      txCount: 90,
      volumeUsd: 25_000n,
      amountsUsd: [2000n, 4000n, 6000n],
      borrowedDaysAgo: [300, 200, 100],
      statuses: [1, 1, 1],
      daysLate: [0, 0, 0],
      source: "aave-v3-arbitrum",
      deadline: BigInt(now + 3600),
      ...overrides,
    };
    const loansHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint64[]", "uint32[]", "uint8[]", "uint32[]"],
        [a.amountsUsd, a.borrowedDaysAgo, a.statuses, a.daysLate]
      )
    );
    const domain = {
      name: "ArbiScore CreditImporter",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await importer.getAddress(),
    };
    const sig = await signer.signTypedData(domain, types, { ...a, loansHash });
    return { a, sig };
  }

  beforeEach(async function () {
    [owner, attester, alice, mallory] = await ethers.getSigners();
    engine = (await (await ethers.getContractFactory("SolidityScoreEngine")).deploy()) as SolidityScoreEngine;
    await engine.init(owner.address, owner.address);
    importer = (await (await ethers.getContractFactory("CreditImporter")).deploy(
      await engine.getAddress(), attester.address
    )) as CreditImporter;
    await engine.setImporter(await importer.getAddress());
    await engine.setDemoMode(false); // production-like: users cannot self-write
  });

  it("imports an attested external history for a new wallet and scores it", async function () {
    const { a, sig } = await attest(attester, alice.address);
    await expect(importer.connect(alice).importCredit(a, sig)).to.emit(importer, "CreditImported");
    const [amounts] = await engine.getLoanHistory(alice.address);
    expect(amounts).to.deep.equal([2000n, 4000n, 6000n]);
    expect(await engine.calculateScore(alice.address)).to.be.greaterThan(600n);
  });

  it("rejects forged signatures, tampered payloads and expired attestations", async function () {
    const forged = await attest(mallory, alice.address);
    await expect(importer.connect(alice).importCredit(forged.a, forged.sig)).to.be.revertedWithCustomError(
      importer,
      "InvalidSignature"
    );
    const { a, sig } = await attest(attester, alice.address);
    await expect(
      importer.connect(alice).importCredit({ ...a, amountsUsd: [50_000n, 50_000n, 50_000n] }, sig)
    ).to.be.revertedWithCustomError(importer, "InvalidSignature");
    await time.increase(3601);
    await expect(importer.connect(alice).importCredit(a, sig)).to.be.revertedWithCustomError(
      importer,
      "AttestationExpired"
    );
  });

  it("only lets the wallet itself import, and only once / never over existing history", async function () {
    const { a, sig } = await attest(attester, alice.address);
    await expect(importer.connect(mallory).importCredit(a, sig)).to.be.revertedWithCustomError(
      importer,
      "NotYourAttestation"
    );
    await importer.connect(alice).importCredit(a, sig);
    const again = await attest(attester, alice.address, { statuses: [1, 1, 1] });
    await expect(importer.connect(alice).importCredit(again.a, again.sig)).to.be.revertedWithCustomError(
      importer,
      "AlreadyHasHistory"
    );
  });

  it("with demo mode off, users can no longer write their own history directly", async function () {
    await expect(
      engine.connect(alice).setMockProfile(alice.address, 1, 1, 1, [], [], [], [])
    ).to.be.revertedWithCustomError(engine, "DemoModeDisabled");
  });
});
