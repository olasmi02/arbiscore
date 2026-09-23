# ArbiScore v2 gas benchmark

Network: `arbitrumSepolia` · 2026-09-23T22:48:27.388Z

Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of 3 estimates.

| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |
|---|---|---|---|---|---|---|---|
| 0 | 707 | 14509 | 32599 | 0.45x | - | - | - |
| 8 | 767 | 65685 | 56538 | 1.16x | 86343 | 74492 | 1.16x |
| 32 | 701 | 220788 | 121719 | 1.81x | 241452 | 141604 | 1.71x |
| 64 | 673 | 428820 | 212843 | 2.01x | 449596 | 232773 | 1.93x |

## Richer model: ensemble over k recency horizons (64 loans)

`scoreEnsemble(user, k)` reads the same 64 loans once and runs the model k times with different recency half-lives, so storage stays fixed while arithmetic grows. Both engines return identical scores.

| k (model evaluations) | Score | Solidity gas | Stylus gas | Stylus advantage |
|---|---|---|---|---|
| 1 | 732 | 451416 | 205977 | 2.19x |
| 4 | 703 | 1216162 | 242347 | 5.02x |
| 16 | 667 | 4275156 | 387745 | 11.03x |
