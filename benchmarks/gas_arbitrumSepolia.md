# ArbiScore v2 gas benchmark

Network: `arbitrumSepolia` · 2026-09-24T11:12:03.586Z

Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of 3 estimates.

| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |
|---|---|---|---|---|---|---|---|
| 0 | 707 | 14542 | 32617 | 0.45x | - | - | - |
| 8 | 677 | 66033 | 56558 | 1.17x | 86752 | 74483 | 1.16x |
| 32 | 652 | 222227 | 121725 | 1.83x | 242969 | 141630 | 1.72x |
| 64 | 632 | 431697 | 212914 | 2.03x | 452548 | 232822 | 1.94x |

## Richer model: ensemble over k recency horizons (64 loans)

`scoreEnsemble(user, k)` reads the same 64 loans once and runs the model k times with different recency half-lives, so storage stays fixed while arithmetic grows. Both engines return identical scores.

| k (model evaluations) | Score | Solidity gas | Stylus gas | Stylus advantage |
|---|---|---|---|---|
| 1 | 672 | 454293 | 206026 | 2.21x |
| 4 | 651 | 1227662 | 242534 | 5.06x |
| 16 | 628 | 4321133 | 388490 | 11.12x |
