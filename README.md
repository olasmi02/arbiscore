# ArbiScore

**A credit market where your repayment history lowers your collateral. The risk model runs in Rust on Arbitrum Stylus, and you borrow and lend Paxos USDG.**

Built for the Arbitrum Open House Singapore Online Buildathon (2026). Live on Arbitrum Sepolia.

---

## The problem

DeFi lenders ask every borrower for roughly 150% collateral, whether they've repaid 50 loans on time or were liquidated last week. Wallets are pseudonymous and bad debt can't be pursued, so protocols price everyone as the worst case. Meanwhile, years of repayment history already sit on-chain, unused.

## What ArbiScore does

1. **Scores repayment history on-chain.** A logistic-regression credit model, running in Rust on Stylus, scores every wallet from its loan history.
2. **Runs a two-sided USDG market around that score.**
   - Lenders supply Paxos USDG and earn interest (ERC-4626 `asUSDG` shares).
   - Borrowers post WETH at a collateral ratio set by their tier: **105%** for Prime, **115%**, **130%**, or **150%** for Subprime.
   - Borrowers pay a fixed APR set by pool utilization plus a tier risk premium.
   - Every repayment or liquidation is written back into the borrower's history.
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

The market is built on **Paxos USDG** on Arbitrum Sepolia ([`0xFFC9…1892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892)). Lenders supply it, borrowers draw and repay it, and interest accrues in it. Testnet USDG is available from [faucet.paxos.com](https://faucet.paxos.com/).

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
| ArbiScoreEngine (Rust / Stylus) | [`0x58Ba8a49d0A33ac334Bb7E65CD5c030DD19fAa8b`](https://sepolia.arbiscan.io/address/0x58Ba8a49d0A33ac334Bb7E65CD5c030DD19fAa8b) |
| ArbiCreditVault (`asUSDG`) | [`0x36ecc282A0536368E6af1c2b6020bd210e916b90`](https://sepolia.arbiscan.io/address/0x36ecc282A0536368E6af1c2b6020bd210e916b90) |
| CreditImporter | [`0x3b7AF3962eA7177e9cB22c67231a2E4360a22cB8`](https://sepolia.arbiscan.io/address/0x3b7AF3962eA7177e9cB22c67231a2E4360a22cB8) |
| ChainlinkPriceOracle (ETH/USD) | [`0xB17b872B2A7c675D72A614FCB8C260F4c398BcE2`](https://sepolia.arbiscan.io/address/0xB17b872B2A7c675D72A614FCB8C260F4c398BcE2) |
| USDG (Paxos) | [`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) |
| Test WETH (collateral, public faucet) | [`0x3234F280192CF69599A4272001AD76d1bfdCfbEf`](https://sepolia.arbiscan.io/address/0x3234F280192CF69599A4272001AD76d1bfdCfbEf) |
| SolidityScoreEngine (benchmark baseline) | [`0x3794B8E649E969Ca9f8c8E08B37bc8CF306b990e`](https://sepolia.arbiscan.io/address/0x3794B8E649E969Ca9f8c8E08B37bc8CF306b990e) |

**Source verification:** all Solidity contracts above are verified on **Arbiscan** ([vault](https://sepolia.arbiscan.io/address/0x36ecc282A0536368E6af1c2b6020bd210e916b90#code), [CreditImporter](https://sepolia.arbiscan.io/address/0x3b7AF3962eA7177e9cB22c67231a2E4360a22cB8#code), [oracle](https://sepolia.arbiscan.io/address/0xB17b872B2A7c675D72A614FCB8C260F4c398BcE2#code), [test WETH](https://sepolia.arbiscan.io/address/0x3234F280192CF69599A4272001AD76d1bfdCfbEf#code), [Solidity baseline](https://sepolia.arbiscan.io/address/0x3794B8E649E969Ca9f8c8E08B37bc8CF306b990e#code)) and on **Sourcify** with an exact match. Reproduce with `npx hardhat run scripts/verify.ts --network arbitrumSepolia` (Arbiscan needs `ETHERSCAN_API_KEY` in `.env`). The Stylus engine's Rust source is in this repo but not yet verified on Arbiscan; see `SECURITY.md`.

Stylus [deployment](https://sepolia.arbiscan.io/tx/0x55a2ffab4205f538da9c9a338cbff71bac40a983bcfa77999cb35d5dc178af2d), [activation](https://sepolia.arbiscan.io/tx/0xaffb2933f410c0dc0fc5876271f4e7c0750d1792aa8c9b625acdb39cee253396) and [cache bid](https://sepolia.arbiscan.io/tx/0x1bfa7db248abf08ad22b8577a4785106ca41a1d6b956f96b014227146f4a48db).

The live smoke test ([`scripts/smokeTest.ts`](contracts/lending_vault/scripts/smokeTest.ts)) checked the following on this deployment:
1. **New wallets:** a fresh wallet scores 300 and is quoted 150% collateral at the live Chainlink price.
2. **Portable credit:** a real Aave V3 borrower's history (31 borrows over 617 days; 24 closed loans imported, 5 held under 14 days skipped) was attested, [imported via EIP-712](https://sepolia.arbiscan.io/tx/0xc9e449a69c7e0ae5820cc023f0abc9ef152edcbec4a5c59fc8f83cb4353c5b4e) and scored **802 (Prime)** by the Stylus engine. Re-importing was rejected with `AlreadyHasHistory`.
3. **Parity:** the "Alice" persona scores exactly **812** on-chain, matching the TypeScript model.

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
 ArbiCreditVault (ERC-4626 USDG) ── getScoreAndTier ──▶ ArbiScoreEngine (Rust / Stylus)
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
   - **Borrow:** click **Test WETH** for collateral, deposit it, and borrow USDG. Repay with interest from the Positions table.
   - **Lend:** get USDG from the Paxos faucet and supply it to earn interest.

## Build and test

```bash
cd contracts/stylus_score && cargo test && node build_wasm.mjs   # 11 tests, Stylus-ready WASM
cd contracts/lending_vault && npm install && npx hardhat test     # 32 tests incl. invariant fuzz
cd frontend && npm install && npm run dev                          # dashboard + /api/attest
```

**Deployment scripts:** see `contracts/lending_vault/scripts/`:
- `deployStylus.ts`: compress, deploy, activate and claim ownership
- `cacheStylus.ts`, then `deploy.ts`
- `supply.ts`, `smokeTest.ts` and `benchmark.ts`.

**Why `build_wasm.mjs`:** recent Rust toolchains link a standard library that emits bulk-memory opcodes, which the Stylus validator rejects. The script uses Binaryen to lower them, and the result compresses to 21.5 KB (limit 24 KB).

**Environment variables for `/api/attest`:** `ATTESTER_PRIVATE_KEY` (server-only), `NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS`, and `ALLOW_DEMO_SOURCE=true` for the labeled demo import.

## Limitations

- **Testnet only.** Demo mode (users writing their own history) is on; turn it off with `setDemoMode(false)`. Collateral is test WETH.
- **The model's weights are hand-calibrated.** Fitting them to real default data, such as Aave liquidation history, is the next step, and it needs no contract changes beyond the coefficients.
- **The attester is trusted.** The roadmap is storage proofs.
- **The Stylus source isn't verified on Arbiscan.** See `SECURITY.md`.

## License

MIT
