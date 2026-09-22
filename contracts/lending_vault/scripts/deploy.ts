/**
 * Deploys the ArbiScore credit market around an existing scoring engine.
 *
 *   STYLUS_ENGINE_ADDRESS=0x... ATTESTER_ADDRESS=0x... npx hardhat run scripts/deploy.ts --network arbitrumSepolia
 *
 * - Borrow asset: Paxos USDG on Arbitrum Sepolia (or a mock USDG on the local network)
 * - Collateral: mock WETH with a public faucet (so judges can get collateral)
 * - Oracle: Chainlink ETH/USD on Arbitrum Sepolia (or a mock on the local network)
 * Supplies all of the deployer's USDG as initial lender liquidity.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEPOLIA = {
  usdg: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
  ethUsdFeed: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
};
const ORACLE_MAX_STALENESS = 24 * 3600;

async function main() {
  const [deployer] = await ethers.getSigners();
  const live = network.name === "arbitrumSepolia";
  console.log(`Network ${network.name} | deployer ${deployer.address} | ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // 1. Scoring engine (Stylus on Sepolia; Solidity reference locally)
  let engineAddress = process.env.STYLUS_ENGINE_ADDRESS;
  if (!engineAddress) {
    const e = await (await ethers.getContractFactory("SolidityScoreEngine")).deploy();
    await e.waitForDeployment();
    engineAddress = await e.getAddress();
    await (await e.init(deployer.address, ethers.ZeroAddress)).wait();
    console.log(`SolidityScoreEngine (local stand-in) ${engineAddress}`);
  }
  const engine = await ethers.getContractAt("IArbiScoreEngine", engineAddress);

  // 2. Assets & oracle
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const weth = await ERC20.deploy("Wrapped Ether (ArbiScore test)", "WETH", 18);
  await weth.waitForDeployment();
  let usdgAddress = SEPOLIA.usdg;
  let oracleAddress: string;
  if (live) {
    const oracle = await (await ethers.getContractFactory("ChainlinkPriceOracle")).deploy(
      SEPOLIA.ethUsdFeed, ethers.ZeroAddress, ORACLE_MAX_STALENESS
    );
    await oracle.waitForDeployment();
    oracleAddress = await oracle.getAddress();
    console.log(`ChainlinkPriceOracle ${oracleAddress}: ETH = $${ethers.formatEther(await oracle.getEthPriceUSD())}`);
  } else {
    const usdg = await ERC20.deploy("Global Dollar (mock)", "USDG", 6);
    await usdg.waitForDeployment();
    usdgAddress = await usdg.getAddress();
    await (await usdg.mint(deployer.address, ethers.parseUnits("100000", 6))).wait();
    const oracle = await (await ethers.getContractFactory("MockPriceOracle")).deploy(ethers.parseEther("3000"));
    await oracle.waitForDeployment();
    oracleAddress = await oracle.getAddress();
  }

  // 3. Vault, wired to the engine
  const vault = await (await ethers.getContractFactory("ArbiCreditVault")).deploy(
    engineAddress, oracleAddress, usdgAddress, await weth.getAddress()
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  await (await engine.init(deployer.address, vaultAddress)).wait();
  console.log(`ArbiCreditVault ${vaultAddress} (${await vault.symbol()}), engine vault = ${await engine.vault()}`);

  // 4. Portable-credit importer
  const attester = process.env.ATTESTER_ADDRESS ?? deployer.address;
  const importer = await (await ethers.getContractFactory("CreditImporter")).deploy(engineAddress, attester);
  await importer.waitForDeployment();
  const importerAddress = await importer.getAddress();
  await (await engine.setImporter(importerAddress)).wait();
  console.log(`CreditImporter ${importerAddress} (attester ${attester})`);

  // 5. Seed lender liquidity with the deployer's USDG
  const usdg = await ethers.getContractAt("MockERC20", usdgAddress);
  const bal = await usdg.balanceOf(deployer.address);
  if (bal > 0n) {
    await (await usdg.approve(vaultAddress, bal)).wait();
    await (await vault.deposit(bal, deployer.address)).wait();
    console.log(`Supplied ${ethers.formatUnits(bal, 6)} USDG as lender liquidity`);
  } else {
    console.log("Deployer holds no USDG yet; supply liquidity later with scripts/supply.ts");
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    contracts: {
      ArbiCreditVault: vaultAddress,
      StylusScoreEngine: engineAddress,
      CreditImporter: importerAddress,
      PriceOracle: oracleAddress,
      USDG: usdgAddress,
      MockWETH: await weth.getAddress(),
    },
  };
  fs.writeFileSync(path.join(__dirname, "../deployments.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
