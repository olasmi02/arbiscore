# ArbiScore v2 gas benchmark

Network: `arbitrumSepolia` · 2026-09-24T06:28:32.058Z

Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of 3 estimates.

| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |
|---|---|---|---|---|---|---|---|
| 0 | 707 | 14509 | 32563 | 0.45x | - | - | - |
| 8 | 767 | 65654 | 56544 | 1.16x | 86344 | 74474 | 1.16x |
| 32 | 701 | 220792 | 121723 | 1.81x | 241456 | 141626 | 1.70x |
| 64 | 673 | 428824 | 212869 | 2.01x | 449600 | 232777 | 1.93x |

## Richer model: ensemble over k recency horizons (64 loans)

`scoreEnsemble(user, k)` reads the same 64 loans once and runs the model k times with different recency half-lives, so storage stays fixed while arithmetic grows. Both engines return identical scores.

| k (model evaluations) | Score | Solidity gas | Stylus gas | Stylus advantage |
|---|---|---|---|---|
| 1 | 732 | 451420 | 205953 | 2.19x |
| 4 | 703 | 1216166 | 242351 | 5.02x |
| 16 | 667 | 4275160 | 387749 | 11.03x |
