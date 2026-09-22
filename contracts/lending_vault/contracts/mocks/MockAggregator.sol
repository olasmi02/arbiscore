// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/AggregatorV3Interface.sol";

/// @dev Test-only Chainlink feed.
contract MockAggregator is AggregatorV3Interface {
    uint8 public immutable override decimals;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;

    constructor(uint8 _decimals, int256 _answer) {
        decimals = _decimals;
        set(_answer, block.timestamp, block.timestamp);
    }

    function set(int256 _answer, uint256 _startedAt, uint256 _updatedAt) public {
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, updatedAt, 1);
    }
}
