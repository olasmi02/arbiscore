// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../ArbiScoreModel.sol";

/// @dev Exposes the pure model for cross-implementation vector tests.
contract ModelHarness {
    function computeScore(
        uint256 firstActivityTs,
        uint256 totalTxs,
        uint256 volumeUsd,
        ArbiScoreModel.Loan[] memory loans,
        uint256 nowTs
    ) external pure returns (uint16) {
        return ArbiScoreModel.computeScore(firstActivityTs, totalTxs, volumeUsd, loans, nowTs);
    }
}
