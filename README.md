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
| 0 | 12,269 | 29,615 | Solidity is 2.4× cheaper |
| 8 | 60,576 | 51,178 | **1.18×** |
| 32 | 212,898 | 116,916 | **1.82×** |
| 64 | 414,850 | 203,887 | **2.03×** |

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
| ArbiScoreEngine (Rust / Stylus) | [`0xA8E32a9128a24eAECd4e9075A1fa4dda9DD1250b`](https://sepolia.arbiscan.io/address/0xA8E32a9128a24eAECd4e9075A1fa4dda9DD1250b) |
| ArbiCreditVault, USDG market (`asUSDG`) | [`0x7A7a4B77597A36958055DC4652eAb542a8466e6A`](https://sepolia.arbiscan.io/address/0x7A7a4B77597A36958055DC4652eAb542a8466e6A#code) |
| ArbiCreditVault, test USDC market (`asUSDC`) | [`0x846e488015b64dfE09ECeEa7996A1b3165B67541`](https://sepolia.arbiscan.io/address/0x846e488015b64dfE09ECeEa7996A1b3165B67541#code) |
| CreditImporter | [`0xf494Cd15Ad8439df3997B56192812D5330D8E8e5`](https://sepolia.arbiscan.io/address/0xf494Cd15Ad8439df3997B56192812D5330D8E8e5#code) |
| ChainlinkPriceOracle (ETH/USD) | [`0xBeB7D2D75184F3c3B405F28448C02050859aF910`](https://sepolia.arbiscan.io/address/0xBeB7D2D75184F3c3B405F28448C02050859aF910#code) |
| USDG (Paxos) | [`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) |
| Test USDC (public faucet) | [`0xA488f89cE03A00E214C216Efd1F68E9960042379`](https://sepolia.arbiscan.io/address/0xA488f89cE03A00E214C216Efd1F68E9960042379#code) |
| Test WETH (collateral, public faucet) | [`0x86Eb3A5BBAB09Df84a26B681593E4c14F45053bD`](https://sepolia.arbiscan.io/address/0x86Eb3A5BBAB09Df84a26B681593E4c14F45053bD#code) |
| SolidityScoreEngine (benchmark baseline) | [`0x3794B8E649E969Ca9f8c8E08B37bc8CF306b990e`](https://sepolia.arbiscan.io/address/0x3794B8E649E969Ca9f8c8E08B37bc8CF306b990e#code) |

**Source verification:**
- **Solidity:** every Solidity contract above is verified on **Arbiscan** (the `#code` links) and on **Sourcify** with an exact match. Reproduce with `npx hardhat run scripts/verify.ts --network arbitrumSepolia` (Arbiscan needs `ETHERSCAN_API_KEY` in `.env`).
- **Stylus engine (reproducible build):** Arbiscan can't verify it, because we post-process the WASM with Binaryen (see Build and test). Instead, anyone can rebuild it and compare hashes. The decompressed on-chain program has SHA-256 **`941a61d955c1b502d6173886be2966ba82e5255ca9e9b1848ec2722940c2e90d`** (68,430 bytes). Build with `node contracts/stylus_score/build_wasm.mjs` (rustc 1.98.1, Binaryen 132 pinned, `Cargo.lock` committed), then run `npx hardhat run scripts/verifyStylusBytecode.ts --network arbitrumSepolia`, which prints `MATCH`.

Stylus [deployment](https://sepolia.arbiscan.io/tx/0x2014f4018c4f49883d68ddfd74549d2ae88358f48415021988c1b8a2f316555e), [activation](https://sepolia.arbiscan.io/tx/0xb2ac3638e721c1391b93045e2c41661683de590ce8ec0c1c7ce09ddf017364e7) and [cache bid](https://sepolia.arbiscan.io/tx/0xd67933a732dd37b3f75afec8436937fd2204684ce6eb1dae23660634004715a9). Demo mode (self-written histories) is **off**.

The live smoke test ([`scripts/smokeTest.ts`](contracts/lending_vault/scripts/smokeTest.ts)) checked the following on this deployment:
1. **New wallets:** a fresh wallet scores 300 and is quoted 150% collateral at the live Chainlink price.
2. **Live lending, no farming:** it [borrowed](https://sepolia.arbiscan.io/tx/0xa84c1b304033f07e5fa1f0bb1aafc590ed3e4ab9e99050cbf98a5653e7a1df12) 5 test USDC and [repaid it with interest](https://sepolia.arbiscan.io/tx/0x12c681b4441c2b10705e6a14acb0dcd548697bb8074b66c34401449c022dc9e9) straight away. The score stayed at **484 → 484**, because an instant loop earns no credit.
3. **Portable credit:** a real Aave V3 borrower's history (31 borrows over 617 days; 24 closed loans imported, 5 held under 14 days skipped) was attested, [imported via EIP-712](https://sepolia.arbiscan.io/tx/0x8e516108c4f87fc183792aacbab88847c5d45d0400e2d97f9b3c8cd1a8de2688) and scored **802 (Prime)** by the Stylus engine. Re-importing was rejected with `AlreadyHasHistory`.
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
cd contracts/lending_vault && npm install && npx hardhat test     # 35 tests incl. invariant fuzz
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
