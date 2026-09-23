# ArbiScore gas benchmark: Stylus (cached) vs Solidity, identical model

Network: `arbitrumSepolia` · 2026-09-23T09:49:43.342Z

Execution gas only (intrinsic, calldata and L1 data fees subtracted). Best of 3 estimates.

| Loans in history | Score | Solidity `calculateScore` | Stylus `calculateScore` | Ratio | Solidity `onLoanClosed` | Stylus `onLoanClosed` | Ratio |
|---|---|---|---|---|---|---|---|
| 0 | 651 | 12264 | 29628 | 0.41x | - | - | - |
| 8 | 697 | 60545 | 51241 | 1.18x | 81247 | 69343 | 1.17x |
| 32 | 623 | 212890 | 116952 | 1.82x | 233551 | 134623 | 1.73x |
| 64 | 594 | 414842 | 203913 | 2.03x | 435637 | 223943 | 1.95x |
