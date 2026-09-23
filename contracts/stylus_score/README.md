# ArbiScoreEngine (Rust / Arbitrum Stylus)

The credit engine behind ArbiScore, written in Rust with `stylus-sdk 0.10.9` and deployed on Arbitrum Sepolia. It stores each wallet's loan history (one storage slot per loan) and scores it with a fixed-point logistic regression. The vaults call it in the same transaction as a borrow.

The model is described in the [main README](../../README.md#the-model). In short:
- It reads the latest 64 loans and computes seven features: repayment quality, depth, liquidations, utilization, wallet age, activity and volume.
- The weights are fitted to Aave V3 liquidation data with guardrails.
- `score = 300 + 550 × sigmoid(β · features)`.
- Tiers: Prime ≥750 → 105%, Near-Prime ≥680 → 115%, Moderate ≥600 → 130%, Subprime → 150%.

All maths is integer fixed-point (scale 1e6), and a test checks that the WASM contains no float instructions. The same model exists in Solidity ([`ArbiScoreModel.sol`](../lending_vault/contracts/ArbiScoreModel.sol)) and TypeScript ([`model.ts`](../../frontend/lib/scoring/model.ts)). All three agree bit-for-bit on the 411 vectors in [`../test_vectors`](../test_vectors).

## Files

- `src/scoring.rs`: the model (features, fixed-point `exp2`/sigmoid, tiers, and the benchmark-only `score_ensemble`).
- `src/lib.rs`: the contract (storage, access control, vault hooks, the importer, demo mode).
- `tests/model_tests.rs`: vector parity, anti-farming, tier boundaries, bounds, and the float-opcode check.
- `rust-toolchain.toml` and `Stylus.toml`: pin Rust 1.91.0 and a Binaryen `wasm-opt` 132 recipe, so builds are reproducible.

## Test

Run on Linux or macOS. On Windows, run it inside WSL.

```bash
cargo test
```

## Build, deploy and verify (reproducible)

```bash
cargo stylus check  --endpoint https://sepolia-rollup.arbitrum.io/rpc
cargo stylus deploy --endpoint https://sepolia-rollup.arbitrum.io/rpc --private-key-path <key> --no-activate
cargo stylus verify --endpoint https://sepolia-rollup.arbitrum.io/rpc --deployment-tx <tx>
```

`cargo stylus deploy` builds inside Docker (image `cargo-stylus-base-0.10.9-toolchain-1.91.0-binaryen-132`), so anyone can rebuild the same bytes.

The `wasm-opt` step in `Stylus.toml` lowers the bulk-memory instructions that Rust's standard library emits, which Stylus activation rejects. It also keeps the program at 23.3 KB, under the 24 KB limit.

After deploying, `contracts/lending_vault/scripts/deployStylus.ts` (with `PROGRAM_ADDRESS`) activates the program and claims ownership in the same run.

`node build_wasm.mjs` builds the same optimized WASM locally with your default toolchain. It exists so the float-opcode test has a binary to inspect; deployments use the cargo-stylus build above.
