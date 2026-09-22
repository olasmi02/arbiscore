/**
 * Deploys + activates the ArbiScore Stylus (Rust/WASM) engine without cargo-stylus.
 * Mirrors `cargo stylus deploy`: brotli-compress the WASM, prefix the Stylus EOF marker,
 * wrap it in minimal CREATE init code, then call ArbWasm.activateProgram.
 *
 * Usage:
 *   node ../stylus_score/build_wasm.mjs
 *   npx hardhat run scripts/deployStylus.ts --network arbitrumSepolia
 *   DRY_RUN=1 npx hardhat run scripts/deployStylus.ts   # size check only
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

const WASM_PATH = path.join(__dirname, "../../stylus_score/target/arbiscore_engine.stylus.wasm");
const ARBWASM = "0x0000000000000000000000000000000000000071";
const EOF_PREFIX = "0xEFF00000";
const MAX_COMPRESSED_BYTES = 24 * 1024;

function buildInitCode(code: Uint8Array): string {
  const len = ethers.zeroPadValue(ethers.toBeHex(code.length), 32).slice(2);
  // PUSH32 len, DUP1, PUSH1 43, PUSH1 0, CODECOPY, PUSH1 0, RETURN, <version 0x00>, <code>
  const prelude = "7f" + len + "80" + "602b" + "6000" + "39" + "6000" + "f3" + "00";
  return "0x" + prelude + ethers.hexlify(code).slice(2);
}

async function main() {
  const wasm = fs.readFileSync(WASM_PATH);
  const compressed = zlib.brotliCompressSync(wasm, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 22,
    },
  });
  const code = ethers.getBytes(ethers.concat([EOF_PREFIX, compressed]));
  console.log(`WASM: ${wasm.length} bytes -> compressed ${compressed.length} bytes (limit ${MAX_COMPRESSED_BYTES})`);
  if (compressed.length > MAX_COMPRESSED_BYTES) throw new Error("Compressed WASM exceeds Stylus 24KB limit");
  if (process.env.DRY_RUN) return;

  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name} | Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // 1. Deploy the compressed program (or reuse PROGRAM_ADDRESS if already deployed)
  let programAddress = process.env.PROGRAM_ADDRESS;
  if (!programAddress) {
    const deployTx = await deployer.sendTransaction({ data: buildInitCode(code) });
    console.log(`Deploy tx: ${deployTx.hash}`);
    const receipt = await deployTx.wait();
    programAddress = receipt!.contractAddress!;
    console.log(`Program deployed at: ${programAddress}`);
  }

  // 2. Activate via ArbWasm precompile (estimate data fee with a 0.01 ETH ceiling, then add 20%)
  const arbWasm = new ethers.Contract(
    ARBWASM,
    ["function activateProgram(address program) payable returns (uint16 version, uint256 dataFee)"],
    deployer
  );
  const [version, dataFee] = await arbWasm.activateProgram.staticCall(programAddress, {
    value: ethers.parseEther("0.01"),
  });
  const fee = (dataFee * 120n) / 100n;
  console.log(`Stylus version ${version}, data fee ${ethers.formatEther(dataFee)} ETH (sending ${ethers.formatEther(fee)})`);
  const actTx = await arbWasm.activateProgram(programAddress, { value: fee });
  console.log(`Activation tx: ${actTx.hash}`);
  await actTx.wait();

  // 3. Claim ownership right away: init() is open until an owner is set, so don't leave a window.
  const engine = new ethers.Contract(
    programAddress,
    ["function init(address,address)", "function owner() view returns (address)"],
    deployer
  );
  if ((await engine.owner()) === ethers.ZeroAddress) {
    await (await engine.init(deployer.address, ethers.ZeroAddress)).wait();
  }
  if ((await engine.owner()) !== deployer.address) throw new Error("Engine owner is not the deployer!");
  console.log(`Engine owned by deployer ${deployer.address}`);

  console.log("===============================================================");
  console.log(`Stylus ArbiScoreEngine live at: ${programAddress}`);
  console.log(`Next: STYLUS_ENGINE_ADDRESS=${programAddress} npx hardhat run scripts/deploy.ts --network arbitrumSepolia`);
}

main().catch((error) => {
  console.error("Stylus deployment failed:", error);
  process.exitCode = 1;
});
