/**
 * Deploys the ArbiScore credit markets around an existing scoring engine (already owned by the deployer).
 *
 *   STYLUS_ENGINE_ADDRESS=0x... ATTESTER_ADDRESS=0x... npx hardhat run scripts/deploy.ts --network arbitrumSepolia
 *
 * - Borrow asset: Paxos USDG on Arbitrum Sepolia (or a mock USDG on the local network)
 * - Collateral: mock WETH with a public faucet (so judges can get collateral)
 * - Oracle: Chainlink ETH/USD on Arbitrum Sepolia (or a mock on the local network)
 * - Second market: test USDC with a public faucet, so live borrowing works without USDG
 * Supplies all of the deployer's USDG and 1,000,000 test USDC as initial lender liquidity.
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

  // 3. Two markets sharing one credit engine: Paxos USDG (primary) and a faucet test USDC
  const testUsdc = await ERC20.deploy("Test USD Coin (ArbiScore)", "USDC", 6);
  await testUsdc.waitForDeployment();
  const deployVault = async (asset: string) => {
    const v = await (await ethers.getContractFactory("ArbiCreditVault")).deploy(
      engineAddress, oracleAddress, asset, await weth.getAddress()
    );
    await v.waitForDeployment();
    const addr = await v.getAddress();
    await (await engine.setVault(addr, true)).wait();
    console.log(`ArbiCreditVault ${addr} (${await v.symbol()}), engine approved = ${await engine.isVault(addr)}`);
    return v;
  };
  const vault = await deployVault(usdgAddress);
  const vaultAddress = await vault.getAddress();
  const usdcVault = await deployVault(await testUsdc.getAddress());

  // 4. Portable-credit importer
  const attester = process.env.ATTESTER_ADDRESS ?? deployer.address;
  const importer = await (await ethers.getContractFactory("CreditImporter")).deploy(engineAddress, attester);
  await importer.waitForDeployment();
  const importerAddress = await importer.getAddress();
  await (await engine.setImporter(importerAddress)).wait();
  console.log(`CreditImporter ${importerAddress} (attester ${attester})`);

  // 5. Lender liquidity: all of the deployer's USDG, and 1,000,000 test USDC
  const usdg = await ethers.getContractAt("MockERC20", usdgAddress);
  const bal = await usdg.balanceOf(deployer.address);
  if (bal > 0n) {
    await (await usdg.approve(vaultAddress, bal)).wait();
    await (await vault.deposit(bal, deployer.address)).wait();
    console.log(`Supplied ${ethers.formatUnits(bal, 6)} USDG`);
  } else {
    console.log("Deployer holds no USDG yet; supply later with scripts/supply.ts");
  }
  const seed = ethers.parseUnits("1000000", 6);
  await (await testUsdc.mint(deployer.address, seed)).wait();
  await (await testUsdc.approve(await usdcVault.getAddress(), seed)).wait();
  await (await usdcVault.deposit(seed, deployer.address)).wait();
  console.log("Supplied 1,000,000 test USDC");

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    contracts: {
      ArbiCreditVault: vaultAddress,
      ArbiCreditVaultUSDC: await usdcVault.getAddress(),
      StylusScoreEngine: engineAddress,
      CreditImporter: importerAddress,
      PriceOracle: oracleAddress,
      USDG: usdgAddress,
      TestUSDC: await testUsdc.getAddress(),
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
