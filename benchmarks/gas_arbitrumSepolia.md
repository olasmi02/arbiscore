# ArbiScore v2 gas benchmark

Network: `arbitrumSepolia` · 2026-09-23T21:35:10.401Z

Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of 3 estimates.

| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |
|---|---|---|---|---|---|---|---|
| 0 | 707 | 12263 | 30419 | 0.40x | - | - | - |
| 8 | 767 | 60968 | 52075 | 1.17x | 81653 | 70045 | 1.17x |
| 32 | 701 | 214613 | 117993 | 1.82x | 235293 | 135530 | 1.74x |
| 64 | 673 | 418277 | 205239 | 2.04x | 439052 | 225126 | 1.95x |

## Richer model: ensemble over k recency horizons (64 loans)

`scoreEnsemble(user, k)` reads the same 64 loans once and runs the model k times with different recency half-lives, so storage stays fixed while arithmetic grows. Both engines return identical scores.

| k (model evaluations) | Score | Solidity gas | Stylus gas | Stylus advantage |
|---|---|---|---|---|
| 1 | 732 | 451356 | 205957 | 2.19x |
| 4 | 703 | 1215914 | 242324 | 5.02x |
| 16 | 667 | 4274157 | 387711 | 11.02x |
