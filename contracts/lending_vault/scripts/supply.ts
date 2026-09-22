/**
 * Supplies the signer's USDG to the vault as lender liquidity (ERC-4626 deposit).
 *   npx hardhat run scripts/supply.ts --network arbitrumSepolia
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const { contracts: C } = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments.json"), "utf8"));
  const [signer] = await ethers.getSigners();
  const usdg = await ethers.getContractAt("MockERC20", C.USDG);
  const vault = await ethers.getContractAt("ArbiCreditVault", C.ArbiCreditVault);
  const bal = await usdg.balanceOf(signer.address);
  if (bal === 0n) throw new Error(`${signer.address} holds no USDG (faucet: https://faucet.paxos.com)`);
  await (await usdg.approve(C.ArbiCreditVault, bal)).wait();
  const tx = await vault.deposit(bal, signer.address);
  await tx.wait();
  console.log(`Supplied ${ethers.formatUnits(bal, 6)} USDG: https://sepolia.arbiscan.io/tx/${tx.hash}`);
  console.log(`Vault total assets: ${ethers.formatUnits(await vault.totalAssets(), 6)} USDG`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
