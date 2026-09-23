# ArbiScore v2 gas benchmark

Network: `arbitrumSepolia` · 2026-09-23T18:07:11.302Z

Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of 3 estimates.

| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |
|---|---|---|---|---|---|---|---|
| 0 | 707 | 12263 | 30417 | 0.40x | - | - | - |
| 8 | 767 | 61048 | 52076 | 1.17x | 81705 | 70001 | 1.17x |
| 32 | 701 | 214844 | 118000 | 1.82x | 235505 | 135529 | 1.74x |
| 64 | 673 | 418764 | 205264 | 2.04x | 439537 | 225151 | 1.95x |

## Richer model: ensemble over k recency horizons (64 loans)

`scoreEnsemble(user, k)` reads the same 64 loans once and runs the model k times with different recency half-lives, so storage stays fixed while arithmetic grows. Both engines return identical scores.

| k (model evaluations) | Score | Solidity gas | Stylus gas | Stylus advantage |
|---|---|---|---|---|
| 1 | 732 | 451842 | 205982 | 2.19x |
| 4 | 703 | 1217873 | 242426 | 5.02x |
| 16 | 667 | 4282006 | 388123 | 11.03x |
