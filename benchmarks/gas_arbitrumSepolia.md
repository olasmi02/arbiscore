# ArbiScore gas benchmark: Stylus (cached) vs Solidity, identical model

Network: `arbitrumSepolia` · 2026-09-22T23:40:45.396Z

Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of 3 estimates.

| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |
|---|---|---|---|---|---|---|---|
| 0 | 651 | 12269 | 29615 | 0.41x | - | - | - |
| 8 | 697 | 60576 | 51178 | 1.18x | 81342 | 69202 | 1.18x |
| 32 | 623 | 212898 | 116916 | 1.82x | 233655 | 134467 | 1.74x |
| 64 | 594 | 414850 | 203887 | 2.03x | 435719 | 223790 | 1.95x |
