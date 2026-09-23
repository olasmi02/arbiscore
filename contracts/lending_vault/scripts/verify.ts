/**
 * Verifies the deployed Solidity contracts (deployments.json):
 * - Sourcify (no key): via the Sourcify v2 API, using the exact compiler input from Hardhat's build info
 *   (hardhat-verify 2.x still targets Sourcify's retired v1 API).
 * - Arbiscan: when ETHERSCAN_API_KEY (an Etherscan V2 key) is set in .env.
 *
 *   npx hardhat run scripts/verify.ts --network arbitrumSepolia
 *   SUBMIT_ONLY=1 ... submits to Arbiscan without waiting for its (slow) queue; re-run to confirm
 */
import { artifacts, ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const { contracts: C } = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments.json"), "utf8"));
const ATTESTER = process.env.ATTESTER_ADDRESS ?? "0x6a93DF7C3c8fFFCddb78b1E6d838B4bB7A9A9631";
const ETH_USD_FEED = "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165";
const SOURCIFY = "https://sourcify.dev/server";

const targets = [
  { fqn: "contracts/ArbiCreditVault.sol:ArbiCreditVault", address: C.ArbiCreditVault, args: [C.StylusScoreEngine, C.PriceOracle, C.USDG, C.MockWETH] },
  { fqn: "contracts/ArbiCreditVault.sol:ArbiCreditVault", address: C.ArbiCreditVaultUSDC, args: [C.StylusScoreEngine, C.PriceOracle, C.TestUSDC, C.MockWETH] },
  { fqn: "contracts/mocks/MockERC20.sol:MockERC20", address: C.TestUSDC, args: ["Test USD Coin (ArbiScore)", "USDC", 6] },
  { fqn: "contracts/CreditImporter.sol:CreditImporter", address: C.CreditImporter, args: [C.StylusScoreEngine, ATTESTER] },
  { fqn: "contracts/ChainlinkPriceOracle.sol:ChainlinkPriceOracle", address: C.PriceOracle, args: [ETH_USD_FEED, "0x0000000000000000000000000000000000000000", 24 * 3600] },
  { fqn: "contracts/mocks/MockERC20.sol:MockERC20", address: C.MockWETH, args: ["Wrapped Ether (ArbiScore test)", "WETH", 18] },
  { fqn: "contracts/SolidityScoreEngine.sol:SolidityScoreEngine", address: C.SolidityScoreEngineBaseline, args: [] },
].filter((t) => t.address);

async function sourcify(fqn: string, address: string, chainId: number) {
  const existing = await fetch(`${SOURCIFY}/v2/contract/${chainId}/${address}`);
  if (existing.ok && (await existing.json()).match) return "already verified";

  const buildInfo = await artifacts.getBuildInfo(fqn);
  if (!buildInfo) throw new Error(`no build info for ${fqn} (run npx hardhat compile)`);
  const res = await fetch(`${SOURCIFY}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier: fqn,
    }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(body.message ?? JSON.stringify(body));

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const job: any = await (await fetch(`${SOURCIFY}/v2/verify/${body.verificationId}`)).json();
    if (job.isJobCompleted) {
      if (job.error) throw new Error(job.error.message ?? JSON.stringify(job.error));
      return `${job.contract?.match ?? "verified"} match`;
    }
  }
  throw new Error("timed out waiting for Sourcify");
}

/** Arbiscan via the Etherscan V2 API (hardhat-verify's etherscan task hangs/misreads args on this setup). */
async function arbiscan(fqn: string, address: string, args: unknown[], chainId: number, apiKey: string) {
  const api = `https://api.etherscan.io/v2/api?chainid=${chainId}`;
  const status = await (await fetch(`${api}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`)).json();
  if (status.result?.[0]?.ContractName) return "already verified";

  const buildInfo = await artifacts.getBuildInfo(fqn);
  if (!buildInfo) throw new Error(`no build info for ${fqn}`);
  const factory = await ethers.getContractFactory(fqn);
  const form = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    contractaddress: address,
    sourceCode: JSON.stringify(buildInfo.input),
    codeformat: "solidity-standard-json-input",
    contractname: fqn,
    compilerversion: `v${buildInfo.solcLongVersion}`,
    constructorArguements: factory.interface.encodeDeploy(args).slice(2), // (sic) Etherscan's parameter name
  });
  const submit = await (await fetch(api, { method: "POST", body: form })).json();
  if (submit.status !== "1") throw new Error(submit.result ?? submit.message);
  if (process.env.SUBMIT_ONLY) return "submitted (queued)";

  // Arbiscan's testnet queue can take many minutes; re-running the script later is safe.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const check = await (
      await fetch(`${api}&module=contract&action=checkverifystatus&guid=${submit.result}&apikey=${apiKey}`)
    ).json();
    if (/pending/i.test(check.result)) continue;
    if (check.status === "1" || /already verified/i.test(check.result)) return "verified";
    throw new Error(check.result);
  }
  throw new Error("still pending in Arbiscan's queue; re-run later to confirm");
}

async function main() {
  const chainId = network.config.chainId!;
  for (const t of targets) {
    console.log(`\n=== ${t.fqn.split(":")[1]} ${t.address}`);
    try {
      console.log(`  Sourcify: ${await sourcify(t.fqn, t.address, chainId)} → https://repo.sourcify.dev/${chainId}/${t.address}`);
    } catch (e: any) {
      console.log(`  Sourcify failed: ${e.message}`);
    }
    if (process.env.ETHERSCAN_API_KEY) {
      try {
        const r = await arbiscan(t.fqn, t.address, t.args, chainId, process.env.ETHERSCAN_API_KEY);
        console.log(`  Arbiscan: ${r} → https://sepolia.arbiscan.io/address/${t.address}#code`);
      } catch (e: any) {
        console.log(`  Arbiscan failed: ${e.message}`);
      }
    }
  }
  if (!process.env.ETHERSCAN_API_KEY) console.log("\n(Arbiscan skipped: set ETHERSCAN_API_KEY in .env to also verify there.)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
