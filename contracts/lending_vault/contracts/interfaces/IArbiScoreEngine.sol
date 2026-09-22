// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ABI of the ArbiScore credit engine. Implemented by the Rust/Stylus engine
/// (contracts/stylus_score) and by SolidityScoreEngine (EVM reference / gas baseline).
interface IArbiScoreEngine {
    struct BorrowerProfileView {
        uint64 firstActivityTimestamp;
        uint64 lastActivityTimestamp;
        uint32 totalTransactions;
        uint256 totalVolumeUSD;
        uint32 loansTaken;
        uint32 loansRepaid;
        uint32 liquidations;
        uint16 lastCalculatedScore;
        bool isInitialized;
    }

    function init(address ownerAddr, address vaultAddr) external;
    function owner() external view returns (address);
    function vault() external view returns (address);
    function demoMode() external view returns (bool);
    function setDemoMode(bool enabled) external;
    function importer() external view returns (address);
    function setImporter(address newImporter) external;

    function calculateScore(address user) external view returns (uint16);
    function getScoreAndTier(address user) external view returns (uint16 score, uint8 tier, uint16 collateralRatioBps);
    function getProfile(address user) external view returns (BorrowerProfileView memory);
    function getLoanHistory(address user)
        external
        view
        returns (
            uint64[] memory amountsUsd,
            uint64[] memory borrowTs,
            uint64[] memory dueTs,
            uint64[] memory closeTs,
            uint8[] memory statuses
        );

    function onLoanOpened(address user, uint64 amountUsd, uint64 dueTs) external returns (uint32 historyIndex);
    function onLoanClosed(address user, uint32 historyIndex, bool liquidated) external returns (uint16 newScore);

    function setMockProfile(
        address user,
        uint32 ageDays,
        uint32 txCount,
        uint256 volumeUsd,
        uint64[] memory amountsUsd,
        uint32[] memory borrowedDaysAgo,
        uint8[] memory statuses,
        uint32[] memory daysLate
    ) external returns (uint16 score);
}
