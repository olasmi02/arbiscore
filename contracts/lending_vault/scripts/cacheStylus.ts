/**
 * Bids to place the Stylus program in ArbOS's program cache (same as `cargo stylus cache bid`),
 * which removes most of the per-call program initialization cost.
 *
 *   PROGRAM_ADDRESS=0x... BID_ETH=0 npx hardhat run scripts/cacheStylus.ts --network arbitrumSepolia
 */
import { ethers } from "hardhat";

async function main() {
  const program = process.env.PROGRAM_ADDRESS!;
  const [signer] = await ethers.getSigners();
  const arbWasmCache = new ethers.Contract(
    "0x0000000000000000000000000000000000000072",
    ["function allCacheManagers() view returns (address[])", "function codehashIsCached(bytes32) view returns (bool)"],
    signer
  );
  const [manager] = await arbWasmCache.allCacheManagers();
  const cm = new ethers.Contract(
    manager,
    ["function getMinBid(address) view returns (uint192)", "function placeBid(address) payable"],
    signer
  );
  const minBid: bigint = await cm.getMinBid(program);
  const bid = process.env.BID_ETH ? ethers.parseEther(process.env.BID_ETH) : minBid;
  console.log(`CacheManager ${manager} | min bid ${ethers.formatEther(minBid)} ETH | bidding ${ethers.formatEther(bid)} ETH`);
  await cm.placeBid.staticCall(program, { value: bid });
  const tx = await cm.placeBid(program, { value: bid });
  console.log(`Bid tx: https://sepolia.arbiscan.io/tx/${tx.hash}`);
  await tx.wait();
  const codehash = ethers.keccak256(await ethers.provider.getCode(program));
  console.log(`Cached: ${await arbWasmCache.codehashIsCached(codehash)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
