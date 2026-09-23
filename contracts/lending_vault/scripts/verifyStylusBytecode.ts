/**
 * Reproducible-build check for the Stylus engine (Arbiscan can't verify Stylus programs that were
 * post-processed with wasm-opt). Decompresses the program's on-chain code and compares its SHA-256
 * with a local build:
 *
 *   node ../stylus_score/build_wasm.mjs            # rustc 1.98.1, binaryen 132 (pinned), Cargo.lock committed
 *   npx hardhat run scripts/verifyStylusBytecode.ts --network arbitrumSepolia
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { createHash } from "crypto";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function main() {
  const { contracts: C } = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments.json"), "utf8"));
  const address = process.env.PROGRAM_ADDRESS ?? C.StylusScoreEngine;
  const code = ethers.getBytes(await ethers.provider.getCode(address));
  if (ethers.hexlify(code.slice(0, 3)) !== "0xeff000") throw new Error(`${address} is not a Stylus program`);
  const onchain = zlib.brotliDecompressSync(code.slice(4)); // 3-byte EOF marker + 1-byte dictionary id
  const local = fs.readFileSync(path.join(__dirname, "../../stylus_score/target/arbiscore_engine.stylus.wasm"));

  console.log(`on-chain ${address}: ${onchain.length} bytes, sha256 ${sha256(onchain)}`);
  console.log(`local build:          ${local.length} bytes, sha256 ${sha256(local)}`);
  console.log(sha256(onchain) === sha256(local) ? "MATCH: the deployed program is this source." : "MISMATCH");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
