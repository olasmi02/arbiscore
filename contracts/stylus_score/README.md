# ArbiScore: Arbitrum Stylus Rust Credit Scoring Engine

The **ArbiScore Credit Scoring Engine** (`ArbiScoreEngine`) is a high-performance, deterministic smart contract written in Rust using the Arbitrum Stylus SDK (`stylus-sdk 0.10.9`). It compiles directly to WebAssembly (`wasm32-unknown-unknown`) and is deployed and activated natively on Arbitrum Sepolia (`chainId: 421614`).

---

## 1. Core Mathematical Model

The scoring engine calculates a normalized credit score $S \in [300, 850]$ (FICO range):

$$S = \text{clamp}\left(300 + S_{\text{age}} + S_{\text{repay}} + S_{\text{activity}} - P_{\text{liq}}, \, 300, \, 850\right)$$

All calculations execute purely in **deterministic integer arithmetic**. Zero floating-point opcodes (`f32`/`f64`) are used, adhering strictly to consensus safety on Arbitrum Stylus.

### Factor 1: Wallet Longevity & Age ($S_{\text{age}} \in [0, 120]$)
$$\text{age\_days} = \frac{\text{block.timestamp} - \text{first\_activity\_timestamp}}{86400}$$
$$S_{\text{age}} = \min\left(120, \, \frac{\text{age\_days} \times 120}{365}\right)$$

### Factor 2: Repayment Reliability ($S_{\text{repay}} \in [0, 250]$)
If $\text{loans\_taken} == 0$, $S_{\text{repay}} = 0$. Otherwise:
$$\text{rate\_bps} = \frac{\min(\text{loans\_repaid}, \text{loans\_taken}) \times 10{,}000}{\text{loans\_taken}}$$
$$\text{base\_repay} = \frac{\text{rate\_bps} \times 190}{10{,}000}$$
$$\text{depth\_bonus} = \min(60, \, \min(\text{loans\_repaid}, \text{loans\_taken}) \times 12)$$
$$S_{\text{repay}} = \min(250, \, \text{base\_repay} + \text{depth\_bonus})$$

### Factor 3: Transaction Frequency & Volume ($S_{\text{activity}} \in [0, 180]$)
- **Frequency ($S_{\text{tx}} \in [0, 90]$):**
  $$S_{\text{tx}} = \min\left(90, \, \frac{\text{total\_transactions} \times 90}{100}\right)$$
- **Volume ($S_{\text{vol}} \in [0, 90]$):**
  $$S_{\text{vol}} = \min\left(90, \, \frac{\min(\text{total\_volume\_usd}, 10{,}000) \times 90}{10{,}000}\right)$$
$$S_{\text{activity}} = S_{\text{tx}} + S_{\text{vol}}$$

### Factor 4: Liquidation Penalty ($P_{\text{liq}} \in [0, 250]$)
Each liquidation event levies an 80-point deduction:
$$P_{\text{liq}} = \min(250, \, \text{liquidations} \times 80)$$

---

## 2. Risk Tiers & Dynamic Collateral Ratios

| Risk Tier | Score Range | Collateral Ratio | Basis Points (bps) | Max LTV |
|-----------|-------------|------------------|--------------------|---------|
| **Prime** (3) | 750 – 850 | **105%** | 10,500 bps | ~95.2% |
| **Near-Prime** (2) | 680 – 749 | **115%** | 11,500 bps | ~87.0% |
| **Moderate** (1) | 600 – 679 | **130%** | 13,000 bps | ~76.9% |
| **Subprime** (0) | 300 – 599 | **150%** | 15,000 bps | ~66.7% |

---

## 3. Persona Archetypes (Empirical Verification)

| Archetype | Age (days) | Tx Count | Volume ($) | Loans Taken | Loans Repaid | Liquidations | Score | Tier | Collateral Ratio |
|---|---|---|---|---|---|---|---|---|---|
| **Prime Alice** | 400 | 120 | $25,000 | 6 | 6 | 0 | **850** | Prime (3) | **105%** (10500 bps) |
| **Near-Prime** | 250 | 60 | $6,000 | 4 | 4 | 0 | **728** | NearPrime (2) | **115%** (11500 bps) |
| **Moderate Charlie** | 120 | 35 | $3,000 | 2 | 2 | 0 | **611** | Moderate (1) | **130%** (13000 bps) |
| **Fresh Charlie** | 2 | 3 | $150 | 0 | 0 | 0 | **303** | Subprime (0) | **150%** (15000 bps) |
| **Degen Bob** | 180 | 85 | $15,000 | 5 | 2 | 2 | **465** | Subprime (0) | **150%** (15000 bps) |

---

## 4. Build & Verification Commands

### Run Unit & Property Tests
```bash
cargo test
```
Runs 7 comprehensive tests:
- `scoring::tests::test_bounds_and_clamping`
- `scoring::tests::test_archetypes`
- `scoring::tests::test_tier_thresholds`
- `test_exact_tier_boundaries`
- `test_persona_archetypes`
- `test_property_100_matrix_bounds` (125 distinct parametric combinations)
- `test_zero_float_opcodes_in_wasm` (WASM opcode instruction decoder)

### Build Release WASM Binary
```bash
cargo build --target wasm32-unknown-unknown --release
```
Output: `target/wasm32-unknown-unknown/release/arbiscore_engine.wasm` (Size: ~64 KB).

### Export Solidity ABI Interface
```bash
cargo run --features export-abi
```
Generates standard Solidity interface `IArbiScoreEngine.sol` supporting both `camelCase` and `snake_case` selectors.

### Deploy to Arbitrum Sepolia
```bash
export PRIVATE_KEY="0x..."
node deploy_sepolia.mjs
```
