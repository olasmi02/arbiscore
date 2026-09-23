# Security notes

ArbiScore is a testnet buildathon project and has **not been audited**. This document lists the threat model, the protections in the code, and the trade-offs we accepted.

## Credit-model integrity

| Threat | Protection |
|---|---|
| **Wash-borrowing:** pumping a score with instant borrow/repay loops | Repayment credit scales with time outstanding and reaches full weight only at 14 days. Every loan pays interest. Test `instant_borrow_repay_loops_earn_no_credit` shows that 1, 3, 20 or 64 instant loops leave a new wallet's score unchanged (Subprime). |
| **Wallet-hopping:** abandoning a bad history | A new wallet scores in the Subprime band and borrows at 150%, the same terms as standard DeFi. Throwing history away never gets better terms. |
| **Erasing history via import** | `CreditImporter` only accepts wallets with **no** ArbiScore history, only the wallet itself can submit its attestation, and attestations expire after 1 hour. Existing records, including liquidations, are final. |
| **Forged external history** | Attestations are EIP-712 signed by the attester key and verified on-chain. Tampered payloads, wrong signers and expired attestations are rejected (tested). |
| **Rewriting credit history** | `setMockProfile` is locked down. The importer may write only to wallets with **no** history. Anyone else, **the owner included**, needs demo mode switched on and can never rewrite a history backing an open loan (`HasOpenLoans`). Approved markets have no write access. Demo mode is **off** on the live engine, so no one can rewrite an existing credit history (checked on-chain: owner → `DemoModeDisabled`, market → `Unauthorized`). |
| **Engine blocking settlement** | The vault records loan outcomes inside `try/catch`: if the engine ever rejects an update, repayment and liquidation still settle and `EngineSyncFailed` is emitted. |
| **Unbounded gas** | Only the latest 64 loans are scored. |

**Trust assumptions:**
- **Attester:** the attester reports Aave history honestly. It only counts closed loans held 14+ days, and anchors loan ages to the real close time.
- **Demo sources:** demo-source imports are clearly labeled in the attestation's on-chain `source` field.
- **Engine owner:** can approve a market (`setVault`), which then reports loan outcomes; can point `setImporter` at a different importer; and can switch demo mode on, which would re-enable profile writes (never over open loans). A production deployment would put these behind a timelock or multisig.
- **Roadmap:** replace the attester with storage proofs.

## Lending market

| Threat | Protection |
|---|---|
| Liquidation bonus paid from other users' collateral (the bug in v1) | The bonus comes only from the liquidated borrower's own locked collateral. When that isn't enough, the liquidator repays proportionally less and the shortfall is **bad debt absorbed by lenders** through the ERC-4626 share price. The invariant test checks that the vault's WETH balance always equals the sum of user collateral. |
| A loan being liquidatable the moment it opens (v1: threshold = borrow ratio) | Per-tier liquidation thresholds sit below the borrow ratios (Prime 105% → 103%, Near-Prime 115% → 110%, Moderate 130% → 120%, Subprime 150% → 130%). The bonus is capped at half the cushion (max 5%). |
| Share-inflation (donation) attack on the first lender | OpenZeppelin ERC-4626 with `_decimalsOffset() = 6` virtual shares. |
| Lenders withdrawing funds that are lent out | `maxWithdraw` and `maxRedeem` are capped at idle cash. |
| Stale or bad price | `ChainlinkPriceOracle` rejects prices ≤ 0, future timestamps, and data older than 24 hours. An optional L2 sequencer-uptime check (with a 1-hour grace period) activates when a feed address is configured; none exists on Arbitrum Sepolia yet. |
| Admin abuse | The scoring engine and oracle are **immutable** in each vault. The vault owner can only `pause()`, which blocks new supply, collateral deposits and borrows; repay, withdrawals, redemptions and liquidations always stay open. The engine owner can approve or revoke markets (`setVault`), set the importer, and switch demo mode; see the trust assumptions below. |
| Reentrancy | `nonReentrant` on every state-changing entry point, including the ERC-4626 `_deposit` and `_withdraw` hooks. External calls follow checks-effects-interactions; the engine is trusted and immutable. |
| Engine `init` front-running | The deploy script claims ownership in the same run that activates the program, and fails if the owner isn't the deployer. |

## Testing

- **Rust:** 11 tests, including 411 cross-implementation vectors, the wash-borrowing test, bounds checks and a no-float-opcode check on the WASM.
- **Hardhat:** 36 tests, including the same 411 vectors against the Solidity port. They also cover liquidation economics, bad debt, pause behavior, oracle staleness and sequencer checks, and EIP-712 import rejection cases. Regression tests cover the engine refusing a history rewrite while a loan is open, settlement surviving an engine revert, and two markets sharing one credit engine.
- **Invariant test:** 150 random actions (deposit, withdraw, borrow, repay, time jumps, price moves, liquidations) across three borrowers. After every step it checks:
  1. collateral held equals the sum of user collateral
  2. locked collateral never exceeds deposited collateral
  3. `totalPrincipal` equals the sum of active principal
  4. the lender share price never falls except through realized bad debt.
- **Live smoke test** ([`scripts/smokeTest.ts`](contracts/lending_vault/scripts/smokeTest.ts)) against the Sepolia deployment.

## Slither

Run with `python -m slither . --filter-paths "node_modules|mocks"` in `contracts/lending_vault`. We fixed:
- divide-before-multiply precision loss in `isLiquidatable`
- state written after the external call in `borrow` (reordered)
- missing zero-address checks in `CreditImporter`
- a shadowed parameter name in the engine interface.

Remaining findings, and why they're accepted:
- **`divide-before-multiply` in `ArbiScoreModel`:** intentional fixed-point arithmetic that must match the Rust engine bit for bit. Precision is covered by the vector tests.
- **`unused-return` on `onLoanClosed` and Chainlink `latestRoundData`:** the new score isn't needed by the vault, and `roundId`/`answeredInRound` are deprecated Chainlink fields.
- **`timestamp`:** loan terms, interest and staleness checks depend on block time by design. Arbitrum timestamps can't be manipulated enough to matter at day granularity.
- **Missing zero-address checks on engine `init`/`setImporter`:** `vault = 0` during deployment is intentional (see front-running above), and both are owner-only.
- **`reentrancy-events` in `importCredit`:** the event is emitted after the call to the trusted, immutable engine.

## Known limitations

- The WETH collateral is a test token with a public faucet. The USDG market uses real Paxos testnet USDG; the second market uses a faucet test USDC.
- The model's coefficients are hand-calibrated, not fitted to default data.
- The Stylus engine isn't Arbiscan-verified (we deploy a Binaryen-post-processed WASM rather than using `cargo stylus`). It is a reproducible build instead: `scripts/verifyStylusBytecode.ts` checks the on-chain program's SHA-256 against a local build.
- The liquidation bonus for Prime borrowers is small (1.5%). On mainnet this may need tuning to keep liquidators interested.
