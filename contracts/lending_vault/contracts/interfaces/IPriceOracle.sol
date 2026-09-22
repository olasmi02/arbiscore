// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ETH/USD price source for the vault. Returns USD per 1 ETH with 18 decimals.
interface IPriceOracle {
    function getEthPriceUSD() external view returns (uint256);
}
