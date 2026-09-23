// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../SolidityScoreEngine.sol";

/// @dev Benchmark-only Solidity engine: adds the ensemble scorer mirrored by the Stylus `bench` build.
contract BenchScoreEngine is SolidityScoreEngine {
    function scoreEnsemble(address user, uint32 horizons) external view returns (uint16) {
        Profile storage p = _profiles[user];
        uint256 len = p.history.length;
        uint256 start = len > ArbiScoreModel.MAX_HISTORY ? len - ArbiScoreModel.MAX_HISTORY : 0;
        ArbiScoreModel.Loan[] memory loans = new ArbiScoreModel.Loan[](len - start);
        for (uint256 i = start; i < len; ++i) {
            StoredLoan storage e = p.history[i];
            loans[i - start] = ArbiScoreModel.Loan(e.amountUsd, e.borrowTs, e.dueTs, e.closeTs, e.status);
        }
        return ArbiScoreModel.scoreEnsemble(
            p.firstActivityTimestamp, p.totalTransactions, p.totalVolumeUSD, loans, block.timestamp, horizons
        );
    }
}
