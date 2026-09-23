# ArbiScore

**A credit layer where your repayment history lowers your collateral. The risk model runs in Rust on Arbitrum Stylus, and two lending markets (Paxos USDG and test USDC) share it.**

Built for the Arbitrum Open House Singapore Online Buildathon (2026). Live on Arbitrum Sepolia.

---

## The problem

DeFi lenders ask every borrower for roughly 150% collateral, whether they've repaid 50 loans on time or were liquidated last week. Wallets are pseudonymous and bad debt can't be pursued, so protocols price everyone as the worst case. Meanwhile, years of repayment history already sit on-chain, unused.

## What ArbiScore does

1. **Scores repayment history on-chain.** A logistic-regression credit model, running in Rust on Stylus, scores every wallet from its loan history.
2. **Runs lending markets around that score.** Two markets, **Paxos USDG** and **test USDC**, share one credit engine, so a repayment in either market improves your terms in both. In each:
   - Lenders supply the stablecoin and earn interest (ERC-4626 `asUSDG` / `asUSDC` shares).
   - Borrowers post WETH at a collateral ratio set by their tier: **105%** for Prime, **115%**, **130%**, or **150%** for Subprime.
   - Borrowers pay a fixed APR set by pool utilization plus a tier risk premium.
   - Every repayment or liquidation is written back into the borrower's shared history.
3. **Makes credit portable.** New wallets don't have to start from zero. Closed Aave V3 loans on Arbitrum One are indexed, signed as an EIP-712 attestation, verified on-chain by `CreditImporter`, and scored immediately.

**Two properties make the score hard to game:**
- **Wallet-hopping doesn't help.** A new wallet scores Subprime and borrows at 150%, the same as a normal DeFi protocol. Walking away from a bad history only returns you to standard terms.
- **Wash-borrowing doesn't help.** Credit from a repaid loan scales with how long it was outstanding (full at 14 days), and every loan pays interest. On a new wallet, 1, 3 or 64 instant borrow-and-repay loops leave the score exactly where it started.

## The model

A fixed-point **logistic regression** over seven features computed from the wallet's latest 64 loans:

| Feature | How it's computed |
|---|---|
| Repayment quality | Each repaid loan is weighted by **recency** (half-life of 180 days), **size** (√amount) and **seasoning** (time outstanding, full at 14 days). A loan repaid 15 days late counts half. Beta-prior smoothing keeps a thin history from producing an extreme score |
| Credit depth | Total weighted evidence, saturating |
| Liquidations | Weighted liquidations, plus overdue open loans at half weight. Both fade over time |
| Utilization | Open principal relative to the largest loan the wallet has repaid |
| Wallet age, activity, volume | Saturating curves |

`score = 300 + 550 × sigmoid(β · features)`. The score maps to tiers: Prime ≥750 → 105%, Near-Prime ≥680 → 115%, Moderate ≥600 → 130%, Subprime → 150%.

The same model is implemented three times, and all three agree **bit-for-bit** on 411 shared test vectors:
- [`scoring.rs`](contracts/stylus_score/src/scoring.rs) is the Stylus engine.
- [`ArbiScoreModel.sol`](contracts/lending_vault/contracts/ArbiScoreModel.sol) is the Solidity port and gas baseline.
- [`model.ts`](frontend/lib/scoring/model.ts) powers the sandbox and lets the dashboard independently re-check every on-chain score.

## Why Stylus: measured, not assumed

We ran the identical model and inputs through both engines on Arbitrum Sepolia. The figures are execution gas only; intrinsic, calldata and L1 fees are subtracted from both. The Stylus program is cached via the ArbOS CacheManager. Full data is in [`benchmarks/`](benchmarks/gas_arbitrumSepolia.md).

| Loans in history | Solidity | Stylus | Stylus advantage |
|---|---|---|---|
| 0 | 12,264 | 29,628 | Solidity is 2.4× cheaper |
| 8 | 60,545 | 51,241 | **1.18×** |
| 32 | 212,890 | 116,952 | **1.82×** |
| 64 | 414,842 | 203,913 | **2.03×** |

**How to read this:**
- **The math is about 6.7× cheaper in Stylus.** Each loan adds about 2,700 gas in Stylus and about 6,300 in Solidity. About 2,100 of each is the storage read for the loan record, which costs the same on both VMs. The remaining arithmetic is roughly 620 gas in Stylus against 4,190 in the EVM.
- **Storage caps the end-to-end gain** at about 2× for a full history.
- **Very short histories favor Solidity**, because Stylus has a fixed entry cost of about 30k gas.
- **The gap widens as the model gets richer**, since compute grows and storage doesn't.

**To be clear:** this model fits in Solidity; it costs about 415k gas at 64 loans. Stylus doesn't make on-chain credit scoring possible for the first time. It makes it about 2× cheaper, and leaves room to grow the model.

## Paxos USDG

The primary market is built on **Paxos USDG** on Arbitrum Sepolia ([`0xFFC9…1892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892)): lenders supply it, borrowers draw and repay it, and interest accrues in it. Testnet USDG comes from [faucet.paxos.com](https://faucet.paxos.com/). At the time of writing the faucet had stopped paying out, so the USDG pool has no liquidity yet. The second market, **test USDC** (public faucet, seeded with 1,000,000), runs the identical vault code, so live borrowing works either way. Because both markets feed one credit engine, ArbiScore works as a credit layer any market can plug into (`setVault`).

## Security

See [`SECURITY.md`](SECURITY.md) for the full threat model and the Slither triage. In brief:
- **Liquidations:** the bonus comes only from the borrower's own collateral; any shortfall is bad debt that lenders absorb.
- **Thresholds:** each tier's liquidation threshold sits below its borrow ratio, so no loan is liquidatable the moment it opens.
- **Oracle:** Chainlink ETH/USD with staleness checks.
- **Admin powers:** the engine and oracle can't be changed after deployment, and pausing only blocks new supply and borrows.
- **Share inflation:** ERC-4626 with a virtual-share offset.
- **Invariant fuzz test:** 150 random actions, checked after every step.

## Live deployment (Arbitrum Sepolia, chain 421614)

| Contract | Address |
|---|---|
| ArbiScoreEngine (Rust / Stylus) | [`0xd60CF3F65E7a219aF4c992672AC16d572e055405`](https://sepolia.arbiscan.io/address/0xd60CF3F65E7a219aF4c992672AC16d572e055405) |
| ArbiCreditVault, USDG market (`asUSDG`) | [`0xdca912bc96a99806a8cF53bfdFBC41B8e0b92C3e`](https://sepolia.arbiscan.io/address/0xdca912bc96a99806a8cF53bfdFBC41B8e0b92C3e#code) |
| ArbiCreditVault, test USDC market (`asUSDC`) | [`0xe82e14050F25Cb798C93A72407D2B8E079133C6f`](https://sepolia.arbiscan.io/address/0xe82e14050F25Cb798C93A72407D2B8E079133C6f#code) |
| CreditImporter | [`0xba4eC290ec6f872D3864E1B7489741f43602Eb1E`](https://sepolia.arbiscan.io/address/0xba4eC290ec6f872D3864E1B7489741f43602Eb1E#code) |
| ChainlinkPriceOracle (ETH/USD) | [`0x747459E754c6dcc3Aad80275d20B85766F148C0C`](https://sepolia.arbiscan.io/address/0x747459E754c6dcc3Aad80275d20B85766F148C0C#code) |
| USDG (Paxos) | [`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) |
| Test USDC (public faucet) | [`0x01997b100e67F927b9091055A237b6404143c9Ac`](https://sepolia.arbiscan.io/address/0x01997b100e67F927b9091055A237b6404143c9Ac#code) |
| Test WETH (collateral, public faucet) | [`0xE78BD7a9D205ec879f3550B4a23a3accA7002384`](https://sepolia.arbiscan.io/address/0xE78BD7a9D205ec879f3550B4a23a3accA7002384#code) |
| SolidityScoreEngine (benchmark baseline) | [`0x6Badd214442c6FFE965f123D8173D8D08616e85E`](https://sepolia.arbiscan.io/address/0x6Badd214442c6FFE965f123D8173D8D08616e85E#code) |

**Source verification:**
- **Solidity:** every Solidity contract above is verified on **Arbiscan** (the `#code` links) and on **Sourcify** with an exact match. Reproduce with `npx hardhat run scripts/verify.ts --network arbitrumSepolia` (Arbiscan needs `ETHERSCAN_API_KEY` in `.env`).
- **Stylus engine (reproducible build):** Arbiscan can't verify it, because we post-process the WASM with Binaryen (see Build and test). Instead, anyone can rebuild it and compare hashes. The decompressed on-chain program has SHA-256 **`753dcf86769adff2f2409097f6b391e18795e63a702b1a38ffc182cf8aac06c4`** (68,347 bytes). Build with `node contracts/stylus_score/build_wasm.mjs` (rustc 1.98.1, Binaryen 132 pinned, `Cargo.lock` committed), then run `npx hardhat run scripts/verifyStylusBytecode.ts --network arbitrumSepolia`, which prints `MATCH`.

Stylus [deployment](https://sepolia.arbiscan.io/tx/0x381e5eac0e16ca482e40aa21613b4965b193477b5e1f9f9ab28a493d6fe477bc), [activation](https://sepolia.arbiscan.io/tx/0x6d11d369c483af87c038c165afeb7c0e001cc732636bc918e118870fcf5893dd) and [cache bid](https://sepolia.arbiscan.io/tx/0x9d07725473004482c10502b8790028a94caecefc70ffd3002992401ae74c39af). Demo mode is **off**, so no one, the owner included, can rewrite an existing credit history.

The live smoke test ([`scripts/smokeTest.ts`](contracts/lending_vault/scripts/smokeTest.ts)) checked the following on this deployment:
1. **New wallets:** a fresh wallet scores 300 and is quoted 150% collateral at the live Chainlink price.
2. **Live lending, no farming:** it [borrowed](https://sepolia.arbiscan.io/tx/0x372fe7a74b8ce25c09abbf7a6d670344bc6c201ef379f3dab40ca4ed74f5d25a) 5 test USDC and [repaid it with interest](https://sepolia.arbiscan.io/tx/0xe05db5a1ec5ea375bb47f7a452dfd6ab73d5dbf24557576417fd7eb4e23f1ed2) straight away. The score stayed at **484 → 484**, because an instant loop earns no credit.
3. **Portable credit:** a real Aave V3 borrower's history (31 borrows over 617 days; 24 closed loans imported, 5 held under 14 days skipped) was attested, [imported via EIP-712](https://sepolia.arbiscan.io/tx/0x0f7e287164ed04bee067efe3cc01ee889382f5adb0e93fc3ac0bff79292af416) and scored **802 (Prime)** by the Stylus engine. Re-importing was rejected with `AlreadyHasHistory`.
4. **Parity:** the "Alice" persona scores exactly **812** on-chain, matching the TypeScript model.

## Architecture

```
 Browser (Next.js + wagmi/viem)
   ├─ Sandbox: TypeScript model re-scores editable persona histories (+ time travel)
   ├─ Live: reads score + history from the engine, re-scores locally → "Independently verified"
   └─ /api/attest: indexes Aave V3 (Arbitrum One) → EIP-712 attestation
          │
          ▼
 CreditImporter ── verify sig, new wallets only ──▶ ┐
                                                     ▼
 ArbiCreditVault x2 (USDG, test USDC) ─ getScoreAndTier ─▶ ArbiScoreEngine (Rust / Stylus)
   supply / redeem · deposit / borrow / repay            per-wallet loan history (1 slot/loan)
   per-tier LTV + liquidation threshold, fixed APR       logistic model over latest 64 loans
   onLoanOpened / onLoanClosed ─────────────────────────▶ every loan outcome is scored
   ChainlinkPriceOracle (ETH/USD, staleness checks)
```

## Try it (judges)

1. Open the dashboard. **Judge Sandbox** is on by default.
2. Switch between **Alice** (812, Prime), **Charlie** (649, Moderate) and **Bob** (442, Subprime). The borrow calculator's collateral ratio and APR follow each tier.
3. With Charlie selected, click **Simulate Repayment**. His $5,000 loan closes on time and the model re-scores him **649 → 760**.
4. To see the anti-farming rule, borrow in the sandbox, repay immediately, and note that the score barely moves. Then **Fast-forward 15 days** and repay again.
5. To go live, connect MetaMask or Rabby on Arbitrum Sepolia and turn the sandbox off:
   - **Import credit:** click **Import my Aave history**, or use the labeled demo import of a public Aave borrower.
   - **Pick a market** with the **Paxos USDG / Test USDC** switch. Test USDC has a one-click faucet and 1,000,000 of liquidity.
   - **Borrow:** click **Test WETH** for collateral, deposit it, and borrow. Repay with interest from the Positions table.
   - **Lend:** supply the market's stablecoin to earn interest (test USDC from the header button; USDG from the Paxos faucet).

## Build and test

```bash
cd contracts/stylus_score && cargo test && node build_wasm.mjs   # 11 tests, Stylus-ready WASM
cd contracts/lending_vault && npm install && npx hardhat test     # 36 tests incl. invariant fuzz
cd frontend && npm install && npm run dev                          # dashboard + /api/attest
```

**Deployment scripts:** see `contracts/lending_vault/scripts/`:
- `deployStylus.ts`: compress, deploy, activate and claim ownership
- `cacheStylus.ts`, then `deploy.ts`
- `supply.ts`, `smokeTest.ts` and `benchmark.ts`.

**Why `build_wasm.mjs`:** recent Rust toolchains link a standard library that emits bulk-memory opcodes, which the Stylus validator rejects. The script uses Binaryen to lower them, and the result compresses to 21.5 KB (limit 24 KB).

**Environment variables for `/api/attest`:** `ATTESTER_PRIVATE_KEY` (server-only), `NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS`, and `ALLOW_DEMO_SOURCE=true` for the labeled demo import.

## Limitations

- **Testnet only.** Demo mode (users writing their own history) is **off**; new wallets bootstrap credit through the attested Aave import. Collateral is test WETH, and the second market uses test USDC.
- **The model's weights are hand-calibrated.** Fitting them to real default data, such as Aave liquidation history, is the next step, and it needs no contract changes beyond the coefficients.
- **The attester is trusted.** The roadmap is storage proofs.
- **The Stylus engine isn't Arbiscan-verified.** It is reproducibly built and hash-checked instead; see Live deployment.

## License

MIT
